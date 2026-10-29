import type { ChatMessage, ExplainPayload } from "./payload.js";

export interface LlmConfig {
  /** OpenAI 호환 기준 주소. 예: https://gateway.example.com/v1, http://localhost:11434/v1 */
  endpoint: string;
  model: string;
  apiKey: string | null;
  /** 사내 게이트웨이 등에 필요한 추가 헤더 */
  headers: Record<string, string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: "auth" | "network" | "rejected" | "not-found" | "cancelled" | "timeout" | "other",
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/** 첫 응답과 조각 사이를 기다리는 시간 */
export const IDLE_TIMEOUT_MS = 60000;

/** 기준 주소 뒤에 경로를 붙인다. 이미 /chat/completions로 끝나는 주소를 받으면 그 앞을 기준으로 본다 */
export function apiUrl(endpoint: string, path: "/chat/completions" | "/models"): string {
  const base = endpoint.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return `${base}${path}`;
}

/** 오류 문구에 키와 헤더 값이 섞이지 않게 지운다 */
export function redact(text: string, cfg: Pick<LlmConfig, "apiKey" | "headers">): string {
  let out = text;
  for (const secret of [cfg.apiKey, ...Object.values(cfg.headers)]) if (secret && secret.length >= 4) out = out.split(secret).join("***");
  return out;
}

function headersOf(cfg: LlmConfig): Record<string, string> {
  return { ...cfg.headers, ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) };
}

function reasonOf(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? "";
  if (code === "ECONNREFUSED") return "끝점이 연결을 거부했습니다. 주소와 포트를 확인하세요 (ECONNREFUSED)";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `끝점 호스트 이름을 찾지 못했습니다 (${code})`;
  if (/CERT|SSL|TLS/i.test(code)) return `끝점의 인증서를 확인하지 못했습니다 (${code})`;
  if (err.cause?.message === "bad port") return "이 포트로는 연결할 수 없습니다. 웹 요청이 막는 포트입니다";
  return code ? `끝점에 닿지 않습니다 (${code})` : "끝점에 닿지 않습니다";
}

async function failFrom(res: Response, cfg: LlmConfig): Promise<LlmError> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      detail = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? "";
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    // 본문 없음
  }
  const s = res.status;
  const code = s === 401 || s === 403 ? "auth" : s === 404 ? "not-found" : s === 400 || s === 422 || s === 429 ? "rejected" : "other";
  const what =
    code === "auth"
      ? "키가 거부되었습니다"
      : code === "not-found"
        ? "끝점이나 모델을 찾을 수 없습니다"
        : s === 429
          ? "요청이 너무 많아 거절되었습니다. 잠시 뒤 다시 시도하세요"
          : code === "rejected"
            ? "요청이 거부되었습니다"
            : s >= 500
              ? "끝점 서버에 오류가 났습니다. 잠시 뒤 다시 시도하세요"
              : "요청이 실패했습니다";
  return new LlmError(redact(`${what} (HTTP ${s})${detail ? `. 서버 응답: ${detail}` : ""}`, cfg), code, s);
}

/** 기다림이 길어지면 멈추는 신호. 조각을 받을 때마다 touch로 다시 잰다 */
function idleSignal(outer: AbortSignal | undefined, ms: number) {
  const ctl = new AbortController();
  let timedOut = false;
  let t = setTimeout(() => ((timedOut = true), ctl.abort()), ms);
  const onOuter = () => ctl.abort();
  outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: ctl.signal,
    touch: () => {
      clearTimeout(t);
      t = setTimeout(() => ((timedOut = true), ctl.abort()), ms);
    },
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(t);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

/** 끝점의 모델 목록. 코드를 보내지 않고 주소와 키를 확인하는 데 쓴다 */
export async function listModels(cfg: LlmConfig, signal?: AbortSignal): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(apiUrl(cfg.endpoint, "/models"), { headers: { accept: "application/json", ...headersOf(cfg) }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  } catch (e) {
    if (signal?.aborted) throw new LlmError("확인을 멈췄습니다", "cancelled");
    if ((e as Error).name === "TimeoutError") throw new LlmError("끝점이 30초 안에 응답하지 않습니다", "timeout");
    throw new LlmError(redact(reasonOf(e), cfg), "network");
  }
  if (!res.ok) throw await failFrom(res, cfg);
  try {
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    return (j.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch {
    throw new LlmError("모델 목록이 아닌 응답을 받았습니다. 기준 주소(…/v1)를 확인하세요", "other", res.status);
  }
}

/**
 * 미리보기에서 확인한 내용을 그대로 보내고 답을 조각으로 돌려준다(설계 6.3 explain).
 * 스트리밍(SSE)을 요청하고, 끝점이 한 번에 답하면 그 답을 한 조각으로 돌려준다
 */
export async function* explain(cfg: LlmConfig, payload: Pick<ExplainPayload, "messages">, signal?: AbortSignal, opts: { idleMs?: number } = {}): AsyncGenerator<string> {
  const idleMs = opts.idleMs ?? IDLE_TIMEOUT_MS;
  const idle = idleSignal(signal, idleMs);
  const body = { model: cfg.model, messages: payload.messages satisfies ChatMessage[], stream: true };
  let res: Response;
  try {
    res = await fetch(apiUrl(cfg.endpoint, "/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream, application/json", ...headersOf(cfg) },
      body: JSON.stringify(body),
      signal: idle.signal,
    });
  } catch (e) {
    idle.done();
    if (signal?.aborted) throw new LlmError("요청을 멈췄습니다", "cancelled");
    if (idle.timedOut()) throw new LlmError(`끝점이 ${Math.round(idleMs / 1000)}초 안에 응답하지 않습니다`, "timeout");
    throw new LlmError(redact(reasonOf(e), cfg), "network");
  }
  try {
    if (!res.ok) throw await failFrom(res, cfg);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/event-stream")) {
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) throw new LlmError("답에 내용이 없습니다", "other", res.status);
      yield text;
      return;
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let any = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      idle.touch();
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let j: { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>; error?: { message?: string } };
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new LlmError(redact(`끝점이 오류를 보냈습니다. 서버 응답: ${j.error.message ?? ""}`, cfg), "other");
        const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? "";
        if (piece) {
          any = true;
          yield piece;
        }
      }
    }
    if (!any) throw new LlmError("답에 내용이 없습니다", "other", res.status);
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (signal?.aborted) throw new LlmError("요청을 멈췄습니다", "cancelled");
    if (idle.timedOut()) throw new LlmError(`끝점이 ${Math.round(idleMs / 1000)}초 동안 아무것도 보내지 않아 멈췄습니다`, "timeout");
    throw new LlmError(redact(`답을 받는 중 연결이 끊겼습니다: ${(e as Error).message}`, cfg), "network");
  } finally {
    idle.done();
  }
}

/** "이름: 값" 줄을 헤더로 읽는다. 빈 줄은 건너뛰고, 형식이 틀린 줄은 알린다 */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(":");
    if (at <= 0) throw new Error(`추가 헤더 ${i + 1}번째 줄은 "이름: 값" 형식이어야 합니다`);
    const name = line.slice(0, at).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error(`추가 헤더 이름 "${name}"에 쓸 수 없는 글자가 있습니다`);
    if (name.toLowerCase() === "authorization") throw new Error("키는 API 키 칸에 넣으세요. authorization 헤더는 앱이 만듭니다");
    out[name] = line.slice(at + 1).trim();
  }
  return out;
}
