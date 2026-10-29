import { ProviderError } from "./types.js";

export type TokenSource = () => Promise<string | null>;

/** 오류 문구에 토큰이 섞여 나가지 않도록 지운다 */
export function redact(text: string, token: string | null): string {
  return token ? text.split(token).join("***") : text;
}

export const REQUEST_TIMEOUT_MS = 30000;

/** fetch가 던진 오류를 사람이 읽을 이유로 바꾼다. 원인 코드는 괄호에 남겨 진단에 쓴다 */
function networkReason(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err.name === "TimeoutError") return `호스트가 ${REQUEST_TIMEOUT_MS / 1000}초 안에 응답하지 않습니다`;
  const code = err.cause?.code ?? "";
  if (code === "ECONNREFUSED") return "호스트가 연결을 거부했습니다. 포트를 확인하세요 (ECONNREFUSED)";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `호스트 이름을 찾지 못했습니다 (${code})`;
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return `호스트에 연결하는 시간이 초과되었습니다 (${code})`;
  if (err.cause?.message === "bad port") return "이 포트로는 연결할 수 없습니다. 웹 요청이 막는 포트입니다";
  if (/CERT|SSL|TLS/i.test(code)) return `호스트의 인증서를 확인하지 못했습니다 (${code})`;
  return code ? `호스트에 닿지 않습니다 (${code})` : "호스트에 닿지 않습니다";
}

export async function request<T>(
  method: string,
  url: string,
  headers: Record<string, string>,
  token: string | null,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    res = await fetch(url, {
      method,
      headers: { accept: "application/json", ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch (e) {
    if (signal?.aborted) throw new ProviderError("확인을 멈췄습니다", null, "cancelled");
    throw new ProviderError(redact(networkReason(e), token), null, "network");
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      detail = j.message ?? j.error ?? "";
    } catch {
      detail = text.slice(0, 200);
    }
    const code = res.status === 401 || res.status === 403 ? "auth" : res.status === 404 ? "not-found" : res.status === 422 || res.status === 400 ? "rejected" : "other";
    const what =
      code === "auth"
        ? "토큰이 거부되었습니다"
        : code === "not-found"
          ? "찾을 수 없습니다(권한이 없을 수도 있습니다)"
          : res.status >= 500
            ? "서버에 오류가 났습니다. 잠시 뒤 다시 시도하세요"
            : "요청이 거부되었습니다";
    // 서버가 준 문구(영문일 수 있음)는 원인 뒤에 따로 붙인다
    throw new ProviderError(`${what} (HTTP ${res.status})${detail ? `. 서버 응답: ${redact(detail, token)}` : ""}`, res.status, code);
  }
  try {
    return { data: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  } catch {
    // 프록시나 로그인 페이지가 HTML을 돌려주는 경우
    throw new ProviderError(`API가 아닌 응답을 받았습니다 (HTTP ${res.status}). 호스트 주소를 확인하세요`, res.status, "other");
  }
}

/** unified diff에서 head 쪽 hunk 범위(1부터)를 읽는다 */
export function headRangesFromPatch(patch: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const m of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) out.push({ start, end: start + count - 1 });
  }
  return out;
}

export function canComment(ranges: DiffRangesLike, path: string, line: number): boolean {
  return (ranges.get(path) ?? []).some((r) => line >= r.start && line <= r.end);
}

type DiffRangesLike = Map<string, Array<{ start: number; end: number }>>;
