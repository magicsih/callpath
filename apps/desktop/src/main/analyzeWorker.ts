import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyze, GitRefSource, guide, isLargeRepo, listGuideFiles, mergeBase, suggestDirs, type GuideProgress, type GuideResult, type ReviewSession,
} from "@callpath/core";
import { createRefiner, JDTLS } from "@callpath/lsp";
import type { CompareRequest, GuideOutcome, GuideRequest, GuideTarget } from "../shared/api";
import { SessionCache } from "./cache";

export type WorkerEvent =
  | { id: number; kind: "fast"; ok: true; value: ReviewSession }
  | { id: number; kind: "fast"; ok: false; error: string }
  | { id: number; kind: "status"; message: string }
  | { id: number; kind: "precise"; ok: true; value: ReviewSession }
  | { id: number; kind: "precise"; ok: false; error: string }
  | { id: number; kind: "reply"; ok: true; value: unknown }
  | { id: number; kind: "reply"; ok: false; error: string }
  | { id: number; kind: "guide-progress"; progress: GuideProgress };

/** 둘러보기 요청(설계 7단계). 답은 reply로 한 번 온다 */
export type GuideAsk =
  | { type: "guide"; req: GuideRequest }
  | { type: "tour"; target: GuideTarget; entryId: string }
  | { type: "through"; target: GuideTarget; classId: string };
type GuideMessage = GuideAsk & { id: number };

const { userData } = workerData as { userData: string };
const lspDir = process.env.CALLPATH_LSP_CACHE ?? join(userData, "lsp");
/** 폴더 안 .js 파일들의 내용 해시 */
function hashDir(h: ReturnType<typeof createHash>, dir: string): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) hashDir(h, p);
    else if (name.endsWith(".js")) h.update(name).update(readFileSync(p));
  }
}

// 분석기가 바뀌면 이전 결과를 쓰지 않도록 이 워커와 코어, LSP 패키지 빌드 결과의 해시를 캐시 키에 넣는다
// 패키지 위치를 못 찾아도 워커는 떠야 하므로, 실패하면 워커 파일 해시와 시각을 써서 캐시를 쓰지 않는 쪽으로 둔다
const version = (() => {
  const h = createHash("sha1").update(readFileSync(fileURLToPath(import.meta.url)));
  try {
    const require = createRequire(import.meta.url);
    for (const pkg of ["@callpath/core", "@callpath/lsp"]) hashDir(h, dirname(require.resolve(pkg)));
  } catch {
    h.update(String(Date.now()));
  }
  return `${h.digest("hex").slice(0, 12)}+jdtls-${JDTLS.version}`;
})();
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

parentPort!.on("message", (msg: { id: number; req: CompareRequest } | GuideMessage) => {
  if ("type" in msg) void handleGuide(msg);
  else void runAnalyze(msg.id, msg.req);
});

async function runAnalyze(id: number, req: CompareRequest): Promise<void> {
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
  // 정밀 분석은 한 번에 하나씩 돌린다. 같은 커밋의 head 사본과 JDT LS 작업 공간을 두 실행이 함께 쓰지 않게 한다
  preciseQueue = preciseQueue
    .then(() => runPrecise(id, req, baseSha, headSha, opts))
    .catch((e) => post({ id, kind: "precise", ok: false, error: e instanceof Error ? e.message : String(e) }));
}

let preciseQueue: Promise<void> = Promise.resolve();

async function runPrecise(id: number, req: CompareRequest, baseSha: string, headSha: string, opts: { repo: string; baseLabel: string; headLabel: string }): Promise<void> {
  // 기다리는 동안 앞선 실행이 같은 비교를 끝냈으면 그 결과를 쓴다
  const done = cache.get(req.repo, baseSha, headSha);
  if (done) {
    post({ id, kind: "precise", ok: true, value: done });
    return;
  }
  try {
    const refine = createRefiner({ repo: req.repo, headSha, cacheDir: lspDir, onStatus: (message) => post({ id, kind: "status", message }) });
    const precise = await analyze(new GitRefSource(req.repo, baseSha), new GitRefSource(req.repo, headSha), { ...opts, refine });
    // 바뀐 메서드가 있는 모든 언어의 정밀 분석이 끝난 결과만 저장한다(도구가 없거나 실패한 언어는 다음에 다시 시도)
    if (Object.values(precise.analysis.languages).every((l) => l!.status === "done")) cache.put(precise);
    post({ id, kind: "precise", ok: true, value: precise });
  } catch (e) {
    post({ id, kind: "precise", ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    prune(join(lspDir, "trees"));
    prune(join(lspDir, "work", "jdtls"));
  }
}

// ---------- 둘러보기 ----------

/** 투어와 클래스를 지나는 진입점은 호출 그래프가 있어야 답할 수 있어, 최근 둘러본 2개를 메모리에 둔다 */
const guides = new Map<string, Promise<GuideResult>>();

function loadGuide(target: GuideTarget, onProgress?: (p: GuideProgress) => void): Promise<GuideResult> {
  const key = [target.repo, target.sha, target.dir ?? ""].join("\u0000");
  const hit = guides.get(key);
  if (hit) return hit;
  const p = guide(new GitRefSource(target.repo, target.sha), {
    ref: target.sha, sha: target.sha, ...(target.dir ? { dir: target.dir } : {}), ...(onProgress ? { onProgress } : {}),
  });
  guides.set(key, p);
  p.catch(() => guides.delete(key));
  while (guides.size > 2) guides.delete(guides.keys().next().value!);
  return p;
}

async function handleGuide(msg: GuideMessage): Promise<void> {
  try {
    let value: unknown;
    if (msg.type === "guide") value = await openGuide(msg.id, msg.req);
    else {
      const result = await loadGuide(msg.target);
      value = msg.type === "tour" ? result.tour(msg.entryId) : result.entriesThrough(msg.classId);
    }
    post({ id: msg.id, kind: "reply", ok: true, value });
  } catch (e) {
    post({ id: msg.id, kind: "reply", ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function openGuide(id: number, req: GuideRequest): Promise<GuideOutcome> {
  const sha = await new GitRefSource(req.repo, req.ref).resolve();
  const dir = req.dir?.trim().replace(/^\/+|\/+$/g, "") || null;
  const target = { repo: req.repo, sha, dir };
  const cached = cache.getGuide(req.repo, sha, dir);
  if (cached) {
    // 지도는 바로 그리고, 투어를 물을 때 바로 답하도록 호출 그래프는 뒤에서 다시 만든다
    loadGuide(target).catch(() => undefined);
    return { status: "ready", guide: { ...cached, ref: req.ref }, cached: true };
  }
  if (!req.force && !dir) {
    const { paths } = await listGuideFiles(new GitRefSource(req.repo, sha));
    if (isLargeRepo(paths.length)) return { status: "large", files: paths.length, sha, dirs: suggestDirs(paths) };
  }
  let last = 0;
  const result = await loadGuide(target, (progress) => {
    // 파일 읽기 소식은 0.1초에 한 번만 보낸다
    const now = Date.now();
    if (progress.stage === "read" && progress.done < progress.total && now - last < 100) return;
    last = now;
    post({ id, kind: "guide-progress", progress });
  });
  cache.putGuide(req.repo, result.guide);
  return { status: "ready", guide: { ...result.guide, ref: req.ref }, cached: false };
}
