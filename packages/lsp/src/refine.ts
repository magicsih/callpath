import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CallHierarchyItem, Range as LspRange } from "vscode-languageserver-protocol";
import { methodId, type CallGraph, type Edge, type FileIndex, type Language, type LanguageAnalysis, type MethodSymbol, type Refiner } from "@callpath/core";
import { LspClient } from "./client.js";
import { findJava } from "./java.js";
import { ensureJdtls, jdtlsCommand } from "./jdtls.js";
import { findKotlinLsp } from "./kotlin.js";
import { exportTree, sourceRoots } from "./workspace.js";

export interface RefinerOptions {
  repo: string;
  headSha: string;
  /** JDT LS 배포판, head 코드, LSP 작업 폴더를 둘 곳 */
  cacheDir: string;
  env?: NodeJS.ProcessEnv;
  onStatus?: (message: string) => void;
  /** 언어 하나의 정밀 분석 전체 제한 시간 */
  timeoutMs?: number;
  /** 질의할 바뀐 메서드 수 상한. 넘으면 앞의 것만 질의한다 */
  maxMethods?: number;
}

interface Cancel {
  cancelled: boolean;
  stop?: () => Promise<void>;
}

class Cancelled extends Error {}

/** 서버가 프로젝트를 다 읽기 전에는 빈 결과를 줄 수 있어 첫 질의는 몇 번 다시 시도한다 */
const READY_RETRIES = 30;

export function createRefiner(opts: RefinerOptions): Refiner {
  const env = opts.env ?? process.env;
  return async ({ graph, changed, files }) => {
    const byLang = new Map<Language, MethodSymbol[]>();
    for (const id of changed) {
      const m = graph.methods.get(id);
      if (!m || m.synthetic) continue;
      byLang.set(m.language, [...(byLang.get(m.language) ?? []), m]);
    }
    const out: Partial<Record<Language, LanguageAnalysis>> = {};
    if (byLang.size === 0) return out;
    if (env.CALLPATH_PRECISE === "off") {
      for (const lang of byLang.keys()) out[lang] = { status: "skipped", code: "disabled", reason: "정밀 분석을 껐습니다" };
      return out;
    }
    let tree: string;
    try {
      // LSP는 심볼릭 링크를 푼 실제 경로로 답한다(macOS의 /var는 /private/var). 같은 기준으로 맞추려고 실제 경로를 쓴다
      tree = realpathSync(await exportTree(opts.repo, opts.headSha, join(opts.cacheDir, "trees", opts.headSha)));
    } catch (e) {
      for (const lang of byLang.keys()) out[lang] = { status: "failed", code: "error", reason: (e as Error).message };
      return out;
    }
    for (const [lang, methods] of byLang) {
      const limited = methods.slice(0, opts.maxMethods ?? 300);
      const cancel: Cancel = { cancelled: false };
      const job = refineLanguage(lang, limited, graph, [...files.values()], tree, opts, env, cancel);
      const timeout = opts.timeoutMs ?? 180000;
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<LanguageAnalysis>((r) => {
        timer = setTimeout(() => {
          // 시간이 지나면 그 뒤의 질의 결과로 그래프를 고치지 않고 서버를 끈다
          cancel.cancelled = true;
          void cancel.stop?.();
          r({ status: "failed", code: "timeout", reason: `정밀 분석이 ${Math.round(timeout / 1000)}초 안에 끝나지 않았습니다` });
        }, timeout);
      });
      out[lang] = await Promise.race([job, expired]);
      clearTimeout(timer);
    }
    return out;
  };
}

async function startServer(lang: Language, files: FileIndex[], tree: string, opts: RefinerOptions, env: NodeJS.ProcessEnv): Promise<LspClient | LanguageAnalysis> {
  if (lang === "java") {
    const java = await findJava(env);
    if ("error" in java) return { status: "skipped", code: "no-tool", reason: java.error };
    let dir: string;
    try {
      dir = await ensureJdtls(join(opts.cacheDir, "tools"), env, opts.onStatus);
    } catch (e) {
      return { status: "failed", code: "error", reason: (e as Error).message };
    }
    const roots = sourceRoots(files, "java");
    const settings = { java: { project: { sourcePaths: roots }, import: { gradle: { enabled: false }, maven: { enabled: false } } } };
    const { command, args } = jdtlsCommand(dir, java.bin, join(opts.cacheDir, "work", "jdtls", opts.headSha));
    opts.onStatus?.("Java 정밀 분석 중");
    const client = await LspClient.start({ name: "JDT LS", command, args, cwd: tree, rootDir: tree, settings });
    // 프로젝트를 다 읽기 전의 호출 계층은 일부만 돌아와, 그것으로 간선을 고치면 흐름이 끊긴다
    if (!(await client.waitForServiceReady(120000))) {
      await client.stop();
      return { status: "failed", code: "timeout", reason: "JDT LS가 120초 안에 프로젝트를 다 읽지 못했습니다" };
    }
    return client;
  }
  const kotlin = await findKotlinLsp(env);
  if ("error" in kotlin) return { status: "skipped", code: "no-tool", reason: kotlin.error };
  opts.onStatus?.("Kotlin 정밀 분석 중");
  return LspClient.start({ name: "kotlin-lsp", command: kotlin.command, args: kotlin.args, cwd: tree, rootDir: tree, settings: {} });
}

async function refineLanguage(lang: Language, methods: MethodSymbol[], graph: CallGraph, files: FileIndex[], tree: string, opts: RefinerOptions, env: NodeJS.ProcessEnv, cancel: Cancel): Promise<LanguageAnalysis> {
  let client: LspClient | null = null;
  const check = () => {
    if (cancel.cancelled) throw new Cancelled();
  };
  try {
    const started = await startServer(lang, files, tree, opts, env);
    if (!(started instanceof LspClient)) return started;
    client = started;
    cancel.stop = () => started.stop();
    check();
    const toPath = (uri: string): string | null => {
      if (!uri.startsWith("file:")) return null;
      let file = fileURLToPath(uri);
      try {
        file = realpathSync(file);
      } catch {
        // 지워진 파일 등은 받은 경로 그대로 비교한다
      }
      const rel = relative(tree, file);
      return rel.startsWith("..") ? null : rel.split(sep).join("/");
    };
    let confirmed = 0;
    let first = true;
    for (const m of methods) {
      const item = await prepareItem(client, join(tree, m.path), m, first ? READY_RETRIES : 1);
      first = false;
      if (!item) continue;
      const id = methodId(m);

      check();
      const outgoing = (await client.outgoing(item)) ?? [];
      check();
      const incomingCalls = (await client.incoming(item)) ?? [];
      check();
      // 나가는, 들어오는 호출이 모두 비었는데 1계층에는 간선이 있으면 아직 다 읽지 못한 결과로 보고 고치지 않는다
      if (outgoing.length === 0 && incomingCalls.length === 0 && (graph.outgoing(id).length > 0 || graph.incoming(id).length > 0)) continue;
      const outEdges: Edge[] = [];
      for (const call of outgoing) {
        const path = toPath(call.to.uri);
        const callee = path ? graph.methodAt(path, call.to.selectionRange.start.line) : null;
        if (!callee) continue; // 저장소 밖(JDK, 라이브러리) 호출
        for (const r of call.fromRanges) outEdges.push({ caller: id, callee: methodId(callee), callIndex: callIndexOf(m, r, callee.name), confidence: "high", source: "lsp" });
        // 인터페이스나 추상 메서드를 부르면 1계층이 찾은 구현 클래스 간선을 함께 남긴다(리뷰어가 구현까지 따라가도록)
        if (!callee.body) {
          for (const e of graph.outgoing(id)) {
            const target = graph.methods.get(e.callee);
            if (target && target.name === callee.name && e.callee !== methodId(callee)) outEdges.push({ ...e, confidence: "medium", source: "lsp" });
          }
        }
      }
      const mappedOut = outEdges.some((e) => e.source === "lsp" && e.confidence === "high");
      // 응답은 있는데 저장소 안 메서드로 하나도 맞추지 못했으면 경로가 어긋난 것으로 보고 1계층 간선을 남긴다
      const outTrusted = outgoing.length === 0 || mappedOut || graph.outgoing(id).length === 0;
      if (outTrusted) graph.replaceOutgoing(id, dedupe(outEdges));

      const inEdges: Edge[] = [];
      for (const call of incomingCalls) {
        const path = toPath(call.from.uri);
        const caller = path ? graph.methodAt(path, call.from.selectionRange.start.line) : null;
        if (!caller) continue;
        for (const r of call.fromRanges) inEdges.push({ caller: methodId(caller), callee: id, callIndex: callIndexOf(caller, r, m.name), confidence: "high", source: "lsp" });
      }
      const inTrusted = incomingCalls.length === 0 || inEdges.length > 0 || graph.incoming(id).length === 0;
      if (inTrusted) graph.replaceIncoming(id, dedupe(inEdges));
      confirmed += (outTrusted ? outEdges.length : 0) + (inTrusted ? inEdges.length : 0);
    }
    return { status: "done", queried: methods.length, confirmedEdges: confirmed };
  } catch (e) {
    if (e instanceof Cancelled || cancel.cancelled) return { status: "failed", code: "timeout", reason: "시간 초과로 멈췄습니다" };
    const detail = client?.lastError;
    return { status: "failed", code: "error", reason: `${(e as Error).message}${detail ? ` (${detail.slice(0, 200)})` : ""}` };
  } finally {
    await client?.stop().catch(() => undefined);
  }
}

async function prepareItem(client: LspClient, file: string, m: MethodSymbol, retries: number): Promise<CallHierarchyItem | null> {
  const languageId = m.language === "java" ? "java" : "kotlin";
  client.open(file, languageId, await readFile(file, "utf8"));
  const pos = m.namePos ?? { line: m.range.startLine, column: 0 };
  for (let i = 0; i < retries; i++) {
    const items = await client.prepare(file, { line: pos.line, character: pos.column });
    if (items && items.length) return items[0]!;
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/** LSP가 알려준 호출 위치를 코어의 호출문 순서에 맞춘다. 맞는 호출문이 없으면 소스 위치로 뒤쪽에 둔다 */
function callIndexOf(caller: MethodSymbol, range: LspRange, calleeName: string): number {
  const line = range.start.line;
  const exact = caller.calls.findIndex((c) => c.line === line && (c.name === calleeName || c.name === `new ${calleeName}`));
  if (exact >= 0) return exact;
  const sameLine = caller.calls.findIndex((c) => c.line === line);
  return sameLine >= 0 ? sameLine : 10000 + line;
}

function dedupe(edges: Edge[]): Edge[] {
  const seen = new Map<string, Edge>();
  for (const e of edges) {
    const k = `${e.caller}|${e.callee}|${e.callIndex}`;
    const prev = seen.get(k);
    if (!prev || (prev.confidence !== "high" && e.confidence === "high")) seen.set(k, e);
  }
  return [...seen.values()];
}
