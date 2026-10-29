import type { CallOrderDiff, ChangeKind, Flow, Step, SymbolRef } from "@callpath/core";

/** 보낼 코드 조각. 줄은 1부터 */
export interface Snippet {
  path: string;
  side: "base" | "head";
  startLine: number;
  endLine: number;
  text: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** 미리보기에 보이고 그대로 전송되는 내용 */
export interface ExplainPayload {
  kind: "flow" | "method";
  title: string;
  /** 포함한 코드 범위. 미리보기에서 어떤 파일의 어디가 나가는지 보인다 */
  scope: Array<Omit<Snippet, "text">>;
  /** 호출 그래프 요약(코드가 아닌 구조 정보) */
  graphSummary: string;
  messages: ChatMessage[];
  /** messages 본문 글자 수 */
  chars: number;
  /** 글자 상한에 걸려 뺀 코드 조각 수 */
  omitted: number;
  /** 뺀 조각의 범위. 미리보기에서 어디를 뺐는지 보인다 */
  omittedScope: Array<Omit<Snippet, "text">>;
}

export type ExplainRequest =
  | { kind: "flow"; flow: Flow; snippets: Snippet[] }
  /** orphan: 진입점에서 닿는 호출을 찾지 못한 단계(진입점 미확정 묶음) */
  | { kind: "method"; step: Step; snippet: Snippet; baseSnippet: Snippet | null; callers: SymbolRef[]; callees: string[]; orphan?: boolean };

/** 한 번에 보내는 코드 조각의 글자 상한. 넘으면 흐름 뒤쪽 조각부터 뺀다 */
export const MAX_CODE_CHARS = 24000;

const CHANGE: Record<ChangeKind, string> = {
  body: "본문 바뀜",
  signature: "시그니처 바뀜",
  renamed: "이름 바뀜",
  added: "새로 생김",
  removed: "삭제됨",
  unchanged: "바뀌지 않음",
};

const short = (s: SymbolRef) => (s.container ? `${s.container.split(".").pop()}.${s.name}` : s.name);

function callOrder(d: CallOrderDiff): string {
  const seq = (calls: CallOrderDiff["head"]) =>
    calls
      .filter((c) => !c.nested)
      .map((c) => c.name)
      .join(" → ");
  const moved = d.moved.map((i) => d.head[i]?.name).filter(Boolean);
  const added = d.added.map((i) => d.head[i]?.name).filter(Boolean);
  const removed = d.removed.map((i) => d.base[i]?.name).filter(Boolean);
  const parts = [`이전 ${seq(d.base) || "(없음)"}`, `이후 ${seq(d.head) || "(없음)"}`];
  if (moved.length) parts.push(`순서가 바뀐 호출: ${moved.join(", ")}`);
  if (added.length) parts.push(`새 호출: ${added.join(", ")}`);
  if (removed.length) parts.push(`없어진 호출: ${removed.join(", ")}`);
  return parts.join(" / ");
}

function stepLine(s: Step): string {
  const tags = [CHANGE[s.change], s.signatureChanged && s.change === "body" ? "시그니처도 바뀜" : null, s.refOf ? "앞 흐름에서 이미 나옴" : null].filter(Boolean);
  const order = s.callOrderDiff ? `\n   호출 순서: ${callOrder(s.callOrderDiff)}` : "";
  return `${s.n}. ${short(s.symbol)} (${s.symbol.path}) [${tags.join(", ")}]${order}`;
}

function fence(s: Snippet): string {
  const lang = s.path.endsWith(".kt") || s.path.endsWith(".kts") ? "kotlin" : "java";
  const side = s.side === "head" ? "변경 후" : "변경 전";
  return `### ${s.path}:${s.startLine}-${s.endLine} (${side})\n\`\`\`${lang}\n${s.text}\n\`\`\``;
}

/**
 * 흐름 순서대로 앞에서부터 채우고, 상한을 넘는 조각부터는 뒤쪽을 모두 뺀다(앞 단계가 더 중요하다).
 * 첫 조각 하나가 상한을 넘으면 그 조각의 앞부분 줄만 보낸다
 */
function fit(snippets: Snippet[]): { kept: Snippet[]; omitted: number; dropped: Snippet[] } {
  const r = fitInner(snippets);
  // 남기는 것은 늘 앞쪽 몇 조각(첫 조각은 줄여서라도)이라 뺀 것은 그 뒤 전부다
  return { ...r, dropped: snippets.slice(r.kept.length) };
}

function fitInner(snippets: Snippet[]): { kept: Snippet[]; omitted: number } {
  const kept: Snippet[] = [];
  let used = 0;
  for (const [i, s] of snippets.entries()) {
    const size = fence(s).length;
    if (used + size <= MAX_CODE_CHARS) {
      kept.push(s);
      used += size;
      continue;
    }
    if (kept.length === 0) {
      const lines = s.text.split("\n");
      let n = lines.length;
      while (n > 1 && fence({ ...s, endLine: s.startLine + n - 1, text: lines.slice(0, n).join("\n") }).length > MAX_CODE_CHARS) n = Math.floor(n * 0.9);
      kept.push({ ...s, endLine: s.startLine + n - 1, text: `${lines.slice(0, n).join("\n")}\n// … 글자 상한으로 이하 ${lines.length - n}줄 생략` });
      return { kept, omitted: snippets.length - 1 };
    }
    return { kept, omitted: snippets.length - i };
  }
  return { kept, omitted: 0 };
}

const SYSTEM = [
  "당신은 Java와 Kotlin 코드 리뷰를 돕는 도우미입니다.",
  "주어진 PR 변경과 호출 구조만 근거로 답하세요. 보이지 않는 코드는 추측하지 말고, 추측이 필요하면 추측이라고 밝히세요.",
  "한국어로, 짧은 문단과 목록으로 답하세요.",
].join(" ");

/** 전송할 내용을 만든다(설계 6.3 preview). 네트워크를 쓰지 않는다 */
export function preview(req: ExplainRequest): ExplainPayload {
  if (req.kind === "flow") {
    const f = req.flow;
    const graphSummary = [`흐름: ${f.label} (진입점 ${f.entry.qualifiedName})`, "단계(호출 순서대로):", ...f.steps.map(stepLine), f.truncated ? "탐색 상한에 걸려 잘린 가지가 있습니다." : ""]
      .filter(Boolean)
      .join("\n");
    const { kept, omitted, dropped } = fit(req.snippets);
    const user = [
      "아래 흐름에서 무엇이 바뀌었는지 진입점부터 호출 순서대로 요약하세요.",
      "호출 순서가 바뀐 곳은 그 결과로 달라지는 동작과 위험(예: 실패했을 때 되돌림)을 짚으세요. 리뷰어가 확인할 점을 마지막에 목록으로 주세요.",
      "",
      "## 호출 구조",
      graphSummary,
      "",
      "## 바뀐 메서드 코드",
      ...kept.map(fence),
      omitted ? `\n(글자 상한으로 코드 조각 ${omitted}개를 뺐습니다)` : "",
    ].join("\n");
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ];
    return { kind: "flow", title: `${f.label} 흐름 요약`, scope: kept.map(({ text: _t, ...r }) => r), graphSummary, messages, chars: user.length + SYSTEM.length, omitted, omittedScope: dropped.map(({ text: _t, ...r }) => r) };
  }
  const s = req.step;
  // 단계의 path는 진입점부터 그 단계 자신까지다. 자신이 빠진 경우에만 붙인다
  const last = s.path[s.path.length - 1];
  const chain = last && last.qualifiedName === s.symbol.qualifiedName && last.path === s.symbol.path ? s.path : [...s.path, s.symbol];
  const graphSummary = [
    `메서드: ${s.symbol.qualifiedName} (${s.symbol.path}) [${CHANGE[s.change]}]`,
    req.orphan
      ? "호출 경로: 진입점에서 이 메서드까지 닿는 호출을 찾지 못했습니다(진입점 미확정)"
      : chain.length > 1
        ? `호출 경로: ${chain.map(short).join(" → ")}`
        : "호출 경로: 이 메서드가 진입점",
    req.callers.length ? `부르는 쪽: ${req.callers.map(short).join(", ")}` : "",
    req.callees.length ? `부르는 메서드: ${req.callees.join(", ")}` : "",
    s.callOrderDiff ? `호출 순서: ${callOrder(s.callOrderDiff)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const snippets = [req.snippet, ...(req.baseSnippet ? [req.baseSnippet] : [])];
  const { kept, omitted, dropped } = fit(snippets);
  const user = [
    "아래 메서드의 변경을 설명하세요. 부르는 쪽과 부르는 메서드 관점에서 영향과 리뷰어가 확인할 점을 짚으세요.",
    "",
    "## 호출 구조",
    graphSummary,
    "",
    "## 코드",
    ...kept.map(fence),
    omitted ? `\n(글자 상한으로 코드 조각 ${omitted}개를 뺐습니다)` : "",
  ].join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
  return { kind: "method", title: `${short(s.symbol)} 설명`, scope: kept.map(({ text: _t, ...r }) => r), graphSummary, messages, chars: user.length + SYSTEM.length, omitted, omittedScope: dropped.map(({ text: _t, ...r }) => r) };
}
