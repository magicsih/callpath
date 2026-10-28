import { parentPort } from "node:worker_threads";
import { analyze, GitRefSource, mergeBase } from "@callpath/core";
import type { CompareRequest } from "../shared/api";

/** 분석은 CPU를 오래 쓰므로 main 프로세스를 막지 않게 워커에서 돌린다 */
parentPort!.on("message", async (msg: { id: number; req: CompareRequest }) => {
  const { id, req } = msg;
  try {
    const baseSha = await mergeBase(req.repo, req.base, req.head);
    const base = new GitRefSource(req.repo, baseSha);
    const head = new GitRefSource(req.repo, req.head);
    const session = await analyze(base, head, { repo: req.repo, baseLabel: baseSha, headLabel: await head.resolve() });
    parentPort!.postMessage({ id, ok: true, value: session });
  } catch (e) {
    parentPort!.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
