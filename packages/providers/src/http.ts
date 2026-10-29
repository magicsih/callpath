import { ProviderError } from "./types.js";

export type TokenSource = () => Promise<string | null>;

/** 오류 문구에 토큰이 섞여 나가지 않도록 지운다 */
export function redact(text: string, token: string | null): string {
  return token ? text.split(token).join("***") : text;
}

export async function request<T>(
  method: string,
  url: string,
  headers: Record<string, string>,
  token: string | null,
  body?: unknown,
): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: "application/json", ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new ProviderError(`호스트에 닿지 않습니다: ${redact((e as Error).message, token)}`, null, "network");
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
    const what = code === "auth" ? "토큰이 거부되었습니다" : code === "not-found" ? "찾을 수 없습니다(권한이 없을 수도 있습니다)" : "요청이 거부되었습니다";
    throw new ProviderError(`${what} (HTTP ${res.status}${detail ? `, ${redact(detail, token)}` : ""})`, res.status, code);
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
