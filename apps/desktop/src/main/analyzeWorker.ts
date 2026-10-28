import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, GitRefSource, mergeBase, type ReviewSession } from "@callpath/core";
import { createRefiner, JDTLS } from "@callpath/lsp";
import type { CompareRequest } from "../shared/api";
import { SessionCache } from "./cache";

export type WorkerEvent =
  | { id: number; kind: "fast"; ok: true; value: ReviewSession }
  | { id: number; kind: "fast"; ok: false; error: string }
  | { id: number; kind: "status"; message: string }
  | { id: number; kind: "precise"; ok: true; value: ReviewSession }
  | { id: number; kind: "precise"; ok: false; error: string };

const { userData } = workerData as { userData: string };
const lspDir = process.env.CALLPATH_LSP_CACHE ?? join(userData, "lsp");
// 분석기가 바뀌면 이전 결과를 쓰지 않도록 이 워커 파일의 내용 해시를 캐시 키에 넣는다
const version = `${createHash("sha1").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 12)}+jdtls-${JDTLS.version}`;
const cache = new SessionCache(join(userData, "cache.db"), version);
const post = (e: WorkerEvent) => parentPort!.postMessage(e);

/** head 코드 사본과 LSP 작업 폴더는 최근 5개만 남긴다 */
function prune(dir: string, keep = 5): void {
  try {
    const entries = readdirSync(dir).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const e of entries.slice(keep)) rmSync(join(dir, e.n), { recursive: true, force: true });
  } catch {
    // 아직 폴더가 없음
  }
}

parentPort!.on("message", async (msg: { id: number; req: CompareRequest }) => {
  const { id, req } = msg;
  let baseSha: string;
  let headSha: string;
  try {
    baseSha = await mergeBase(req.repo, req.base, req.head);
    headSha = await new GitRefSource(req.repo, req.head).resolve();
  } catch (e) {
    post({ id, kind: "fast", ok: false, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  const cached = cache.get(req.repo, baseSha, headSha);
  if (cached) {
    post({ id, kind: "fast", ok: true, value: cached });
    post({ id, kind: "precise", ok: true, value: cached });
    return;
  }
  const opts = { repo: req.repo, baseLabel: baseSha, headLabel: headSha };
  try {
    post({ id, kind: "fast", ok: true, value: await analyze(new GitRefSource(req.repo, baseSha), new GitRefSource(req.repo, headSha), opts) });
  } catch (e) {
    post({ id, kind: "fast", ok: false, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  try {
    const refine = createRefiner({ repo: req.repo, headSha, cacheDir: lspDir, onStatus: (message) => post({ id, kind: "status", message }) });
    const precise = await analyze(new GitRefSource(req.repo, baseSha), new GitRefSource(req.repo, headSha), { ...opts, refine });
    // 정밀 분석이 실제로 끝난 결과만 저장한다(도구가 없거나 실패한 결과는 다음에 다시 시도)
    if (precise.analysis.precise === "done") cache.put(precise);
    post({ id, kind: "precise", ok: true, value: precise });
  } catch (e) {
    post({ id, kind: "precise", ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    prune(join(lspDir, "trees"));
    prune(join(lspDir, "work", "jdtls"));
  }
});
