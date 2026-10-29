import { app, shell, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { explain, listModels, LlmError, parseHeaders, preview, type ExplainPayload, type LlmConfig, type Snippet } from "@callpath/llm";
import type { Step, SymbolRef } from "@callpath/core";
import type { ExplainPreview, ExplainTarget, LlmSaved, LlmSettingsInput, LlmSettingsView } from "../shared/api";
import { readAt } from "./repo";
import { decryptSecret, encryptSecret, isWeakStorage } from "./secrets";

interface Stored {
  enabled: boolean;
  endpoint: string;
  model: string;
  /** safeStorage로 암호화한 키(base64) */
  apiKey?: string;
  /** safeStorage로 암호화한 추가 헤더 JSON(base64). 사내 게이트웨이 토큰이 들어갈 수 있어 값도 암호화한다 */
  headers?: string;
  headerNames?: string[];
}

const file = () => join(app.getPath("userData"), "llm.json");
export const logPath = () => join(app.getPath("userData"), "llm-log.jsonl");

async function load(): Promise<Stored> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Stored;
  } catch {
    return { enabled: false, endpoint: "", model: "" };
  }
}

async function persist(s: Stored): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  await rename(tmp, file());
}

function view(s: Stored): LlmSettingsView {
  return { enabled: s.enabled, endpoint: s.endpoint, model: s.model, hasKey: !!s.apiKey, headerNames: s.headerNames ?? [], weakStorage: isWeakStorage(), logPath: logPath() };
}

function configOf(s: Stored): LlmConfig {
  return {
    endpoint: s.endpoint,
    model: s.model,
    apiKey: s.apiKey ? decryptSecret(s.apiKey) : null,
    headers: s.headers ? (JSON.parse(decryptSecret(s.headers)) as Record<string, string>) : {},
  };
}


export async function getLlmSettings(): Promise<LlmSettingsView> {
  return view(await load());
}

const checks = new Map<string, AbortController>();

export function cancelLlmCheck(requestId: string): void {
  checks.get(requestId)?.abort();
}

/** 켜면 모델 목록으로 끝점과 키를 확인한 뒤 저장한다. 코드는 보내지 않는다 */
export async function saveLlmSettings(input: LlmSettingsInput, requestId?: string): Promise<LlmSaved> {
  const prev = await load();
  const endpoint = input.endpoint.trim().replace(/\/+$/, "");
  const model = input.model.trim();
  if (input.enabled) {
    if (!endpoint) throw new Error("끝점 주소를 넣으세요");
    if (!/^https?:\/\//.test(endpoint)) throw new Error("끝점 주소는 http:// 또는 https://로 시작해야 합니다");
    if (!model) throw new Error("모델 이름을 넣으세요");
  }
  const next: Stored = { enabled: input.enabled, endpoint, model };
  if (input.apiKey === undefined) {
    if (prev.apiKey) next.apiKey = prev.apiKey;
  } else if (input.apiKey && input.apiKey.trim()) next.apiKey = encryptSecret(input.apiKey.trim());
  if (input.headers === undefined) {
    if (prev.headers) {
      next.headers = prev.headers;
      next.headerNames = prev.headerNames ?? [];
    }
  } else if (input.headers && input.headers.trim()) {
    const parsed = parseHeaders(input.headers);
    if (Object.keys(parsed).length) {
      next.headers = encryptSecret(JSON.stringify(parsed));
      next.headerNames = Object.keys(parsed);
    }
  }
  let note: string | null = null;
  if (next.enabled) {
    const ctl = new AbortController();
    if (requestId) checks.set(requestId, ctl);
    try {
      const models = await listModels(configOf(next), ctl.signal);
      if (models.length && !models.includes(model)) note = `끝점의 모델 목록에 "${model}"이 없습니다. 이름을 확인하세요 (목록: ${models.slice(0, 5).join(", ")}${models.length > 5 ? " 등" : ""})`;
    } catch (e) {
      // 모델 목록을 열지 않는 끝점도 있다. 주소와 키는 맞을 수 있으므로 저장하고 알린다
      if (e instanceof LlmError && e.code === "not-found") note = "이 끝점은 모델 목록을 지원하지 않아 주소와 키를 미리 확인하지 못했습니다. 첫 요청에서 확인됩니다";
      else throw e;
    } finally {
      if (requestId) checks.delete(requestId);
    }
  }
  await persist(next);
  return { view: view(next), note };
}

// ---------- 미리보기와 전송 ----------

const pending = new Map<string, { payload: ExplainPayload; cfg: LlmConfig; created: number }>();
const running = new Map<string, AbortController>();
/** 확인하지 않고 둔 미리보기는 30분 뒤 버린다 */
const PREVIEW_TTL_MS = 30 * 60 * 1000;

async function snippetOf(repo: string, ref: string, sym: SymbolRef, side: "base" | "head"): Promise<Snippet | null> {
  const text = await readAt(repo, ref, sym.path);
  if (text === null) return null;
  const lines = text.split("\n");
  const { startLine, endLine } = sym.range;
  return { path: sym.path, side, startLine: startLine + 1, endLine: endLine + 1, text: lines.slice(startLine, endLine + 1).join("\n") };
}

/** 단계의 코드. 지워진 메서드는 변경 전, 나머지는 변경 후 */
async function stepSnippet(repo: string, base: string, head: string, s: Step): Promise<Snippet | null> {
  return s.change === "removed" ? (s.baseSymbol ? snippetOf(repo, base, s.baseSymbol, "base") : null) : snippetOf(repo, head, s.symbol, "head");
}

export async function previewExplain(req: { repo: string; base: string; head: string; target: ExplainTarget }): Promise<ExplainPreview> {
  const s = await load();
  if (!s.enabled) throw new Error("LLM 설명이 꺼져 있습니다. LLM 설정에서 끝점을 등록하고 켜세요");
  for (const [id, p] of pending) if (Date.now() - p.created > PREVIEW_TTL_MS) pending.delete(id);
  const { repo, base, head, target } = req;
  let payload: ExplainPayload;
  if (target.kind === "flow") {
    // 설계 6.3 전송 범위: 이 흐름에서 바뀐 메서드만. 앞 흐름에서 이미 나온 단계와 바뀌지 않은 경유 메서드는 코드를 보내지 않는다
    const steps = target.flow.steps.filter((x) => x.change !== "unchanged" && !x.refOf);
    const snippets = (await Promise.all(steps.map((x) => stepSnippet(repo, base, head, x)))).filter((x): x is Snippet => x !== null);
    payload = preview({ kind: "flow", flow: target.flow, snippets });
  } else {
    const st = target.step;
    const snippet = await stepSnippet(repo, base, head, st);
    if (!snippet) throw new Error("이 메서드의 코드를 읽지 못했습니다");
    const baseSnippet = st.change !== "removed" && st.change !== "added" && st.baseSymbol ? await snippetOf(repo, base, st.baseSymbol, "base") : null;
    // 단계의 path는 진입점부터 자신까지라 바로 앞이 부르는 쪽이다
    const callers = st.path.length >= 2 ? [st.path[st.path.length - 2]!] : [];
    payload = preview({ kind: "method", step: st, snippet, baseSnippet, callers, callees: target.callees });
  }
  const cfg = configOf(s);
  const id = randomUUID();
  pending.set(id, { payload, cfg, created: Date.now() });
  return { id, payload, endpointHost: new URL(cfg.endpoint).host, model: cfg.model };
}

async function log(entry: Record<string, unknown>): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await appendFile(logPath(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/** 미리보기에서 확인한 그 내용만 보낸다. 미리보기 없이 보내는 길은 없다(설계 3.4, 인수조건 A10) */
export async function sendExplain(id: string, sender: WebContents): Promise<void> {
  const p = pending.get(id);
  if (!p) throw new Error("미리보기가 만료되었습니다. 다시 열어 확인하세요");
  pending.delete(id);
  const ctl = new AbortController();
  running.set(id, ctl);
  const emit = (e: Record<string, unknown>) => !sender.isDestroyed() && sender.send("llm-event", { id, ...e });
  let answer = "";
  // 보내기 전에 무엇을 어디로 보내는지 먼저 남긴다. 앱이 도중에 꺼져도 나간 내용은 기록에 있다(키와 헤더 값은 남기지 않는다)
  await log({ id, time: new Date().toISOString(), status: "sent", endpoint: p.cfg.endpoint, model: p.cfg.model, kind: p.payload.kind, title: p.payload.title, scope: p.payload.scope, messages: p.payload.messages });
  const result = (r: Record<string, unknown>) => log({ id, time: new Date().toISOString(), ...r });
  // 답은 기다리지 않고 조각마다 보내고, 끝나면 결과를 한 줄 더 남긴다
  void (async () => {
    try {
      for await (const piece of explain(p.cfg, p.payload, ctl.signal)) {
        answer += piece;
        emit({ type: "chunk", text: piece });
      }
      emit({ type: "done" });
      await result({ status: "done", answer });
    } catch (e) {
      const err = e instanceof LlmError ? e : new LlmError((e as Error).message, "other");
      emit({ type: "error", error: err.message, kind: err.code });
      await result({ status: err.code === "cancelled" ? "cancelled" : "error", error: err.message, answer }).catch(() => undefined);
    } finally {
      running.delete(id);
    }
  })();
}

export function cancelExplain(id: string): void {
  running.get(id)?.abort();
}

export function showLlmLog(): void {
  shell.showItemInFolder(logPath());
}
