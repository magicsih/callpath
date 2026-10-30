import { displayName, type CallOrderDiff, type ChangeKind, type Flow, type Step, type SymbolRef } from "@callpath/core";

/** 보낼 코드 조각. 줄은 1부터 */
export interface Snippet {
  /** 화면에 보이는 메서드 이름(예: OrderService.placeOrder) */
  name?: string;
  /** 글자 상한으로 앞부분만 남겼으면 원래 끝 줄 */
  truncatedFrom?: number;
  /** 바뀌지 않은 메서드(진입점 등). 변경 후라고 적지 않는다 */
  unchanged?: boolean;
  /** 비교 없이 한 시점의 코드(둘러보기). "현재 코드"라고 적는다 */
  current?: boolean;
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
  kind: "flow" | "method" | "class" | "package";
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

/** 둘러보기 패키지 설명에 보내는 클래스 요약. 코드 본문은 넣지 않는다 */
export interface PackageClass {
  name: string;
  role: string;
  kind: string;
  /** 공개 메서드 시그니처. 예: placeOrder(OrderRequest) */
  methods: string[];
}

export type ExplainRequest =
  | { kind: "flow"; flow: Flow; snippets: Snippet[] }
  /** 둘러보기(설계 7단계 7절): 한 클래스의 현재 코드와 저장소 안 위치 */
  | { kind: "class"; name: string; qualifiedName: string; role: string; classKind: string; packageLabel: string; snippet: Snippet; callers: string[]; callees: string[]; entries: string[] }
  /** 둘러보기: 패키지의 클래스 목록, 역할, 공개 메서드 시그니처, 다른 패키지와의 연결 수. 메서드 본문은 보내지 않는다 */
  | { kind: "package"; name: string; label: string; classes: PackageClass[]; dependsOn: Array<{ label: string; calls: number }>; usedBy: Array<{ label: string; calls: number }> }
  /** orphan: 진입점에서 닿는 호출을 찾지 못한 단계(진입점 미확정 묶음) */
  | { kind: "method"; step: Step; snippet: Snippet; baseSnippet: Snippet | null; callers: SymbolRef[]; callees: string[]; orphan?: boolean };

/** 한 번에 보내는 코드 조각의 글자 상한. 넘으면 흐름 뒤쪽 조각부터 뺀다 */
export const MAX_CODE_CHARS = 24000;
/** 호출 구조 요약의 글자 상한 */
export const MAX_SUMMARY_CHARS = 4000;

const CHANGE: Record<ChangeKind, string> = {
  body: "본문 바뀜",
  signature: "시그니처 바뀜",
  renamed: "이름 바뀜",
  added: "새로 생김",
  removed: "삭제됨",
  unchanged: "바뀌지 않음",
};

// 화면의 이름 표기(생성자, init 블록 등)와 같게 한다
const short = (s: SymbolRef) => displayName(s);

/** 연달아 같은 호출은 묶는다. 예: append ×460 */
function runs(names: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < names.length; ) {
    let j = i;
    while (j < names.length && names[j] === names[i]) j++;
    out.push(j - i > 1 ? `${names[i]} ×${j - i}` : names[i]!);
    i = j;
  }
  return out;
}

/** 같은 이름은 한 번만, 여러 번이면 횟수를 붙인다 */
function uniq(names: Array<string | undefined>): string[] {
  const count = new Map<string, number>();
  for (const n of names) if (n) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
}

function callOrder(d: CallOrderDiff): string {
  const seq = (calls: CallOrderDiff["head"]) => runs(calls.filter((c) => !c.nested).map((c) => c.name)).join(" → ");
  const moved = uniq(d.moved.map((i) => d.head[i]?.name));
  const added = uniq(d.added.map((i) => d.head[i]?.name));
  const removed = uniq(d.removed.map((i) => d.base[i]?.name));
  const parts = [`이전 ${seq(d.base) || "(없음)"}`, `이후 ${seq(d.head) || "(없음)"}`];
  if (moved.length) parts.push(`순서가 바뀐 호출: ${moved.join(", ")}`);
  if (added.length) parts.push(`새 호출: ${added.join(", ")}`);
  if (removed.length) parts.push(`없어진 호출: ${removed.join(", ")}`);
  return parts.join(" / ");
}

const tagsOf = (s: Step) => [CHANGE[s.change], s.signatureChanged && s.change === "body" ? "시그니처도 바뀜" : null, s.refOf ? "앞 흐름에서 이미 나옴" : null].filter(Boolean).join(", ");

/** 요약이 너무 길면 뒤를 줄인다. 코드 상한과 따로 둔다 */
function capSummary(text: string): string {
  return text.length <= MAX_SUMMARY_CHARS ? text : `${text.slice(0, MAX_SUMMARY_CHARS)}\n… (호출 구조가 길어 이하 줄임)`;
}

function stepLine(s: Step): string {
  const tags = tagsOf(s);
  const order = s.callOrderDiff ? `\n   호출 순서: ${callOrder(s.callOrderDiff)}` : "";
  return `${s.n}. ${short(s.symbol)} (${s.symbol.path}) [${tags}]${order}`;
}

function fence(s: Snippet): string {
  const lang = s.path.endsWith(".kt") || s.path.endsWith(".kts") ? "kotlin" : "java";
  const side = s.current ? "현재 코드" : s.unchanged ? "바뀌지 않음" : s.side === "head" ? "변경 후" : "변경 전";
  return `### ${s.path}:${s.startLine}-${s.endLine} (${side})\n\`\`\`${lang}\n${s.text}\n\`\`\``;
}

/** 혼자 상한을 넘는 조각을 앞부분만 남긴다. 덧붙이는 생략 안내까지 넣은 최종 길이로 재고, 한 줄이 너무 길면 글자로 자른다 */
function truncate(s: Snippet, budget = MAX_CODE_CHARS): Snippet {
  const lines = s.text.split("\n");
  const build = (n: number, cut?: number): Snippet => {
    const body = cut === undefined ? lines.slice(0, n).join("\n") : lines[0]!.slice(0, cut);
    const rest = lines.length - n;
    const note = cut === undefined ? `// … 글자 상한으로 이하 ${rest}줄 생략` : "// … 글자 상한으로 이 줄의 뒷부분과 이하 생략";
    return { ...s, endLine: s.startLine + n - 1, truncatedFrom: s.endLine, text: `${body}\n${note}` };
  };
  let n = lines.length;
  while (n > 1 && fence(build(n)).length > budget) n = Math.max(1, Math.floor(n * 0.9));
  if (fence(build(n)).length <= budget) return build(n);
  // 한 줄만으로도 넘는다(최소화한 코드 등). 첫 줄을 글자로 자른다
  const overhead = fence(build(1, 0)).length;
  return build(1, Math.max(0, budget - overhead));
}

/**
 * 메서드 설명은 변경 전후를 비교해야 하므로 둘 다 넣는다. 합쳐 상한을 넘으면 변경 전 자리(최대 절반)를 먼저 남기고 변경 후를 자른다
 */
function fitPair(head: Snippet, base: Snippet | null): { kept: Snippet[]; omitted: number; dropped: Snippet[] } {
  const headSize = fence(head).length;
  const baseSize = base ? fence(base).length : 0;
  if (headSize + baseSize <= MAX_CODE_CHARS) return { kept: base ? [head, base] : [head], omitted: 0, dropped: [] };
  const baseBudget = base ? Math.min(baseSize, Math.floor(MAX_CODE_CHARS / 2)) : 0;
  const keptHead = headSize <= MAX_CODE_CHARS - baseBudget ? head : truncate(head, MAX_CODE_CHARS - baseBudget);
  if (!base) return { kept: [keptHead], omitted: 0, dropped: [] };
  const left = MAX_CODE_CHARS - fence(keptHead).length;
  return { kept: [keptHead, baseSize <= left ? base : truncate(base, left)], omitted: 0, dropped: [] };
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
      kept.push(truncate(s));
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

const GUIDE_SYSTEM = [
  "당신은 처음 보는 Java와 Kotlin 저장소를 파악하도록 돕는 도우미입니다.",
  "주어진 코드와 구조 정보만 근거로 답하세요. 보이지 않는 코드는 추측하지 말고, 추측이 필요하면 추측이라고 밝히세요.",
  "한국어로, 짧은 문단과 목록으로 답하세요.",
].join(" ");

const list = (label: string, items: string[]) => (items.length ? `${label}: ${items.join(", ")}` : "");

/** 설계 7단계 7절: 클래스는 현재 코드와 위치, 패키지는 구조만(메서드 본문 없음) */
function previewGuide(req: Extract<ExplainRequest, { kind: "class" | "package" }>): ExplainPayload {
  if (req.kind === "class") {
    const graphSummary = capSummary(
      [
        `클래스: ${req.name} (${req.qualifiedName}, ${req.snippet.path})`,
        `패키지: ${req.packageLabel}, 역할: ${req.role}, 종류: ${req.classKind}`,
        list("부르는 쪽", req.callers),
        list("부르는 것", req.callees),
        list("이 클래스를 지나는 진입점", req.entries),
      ].filter(Boolean).join("\n"),
    );
    const size = fence(req.snippet).length;
    const kept = size <= MAX_CODE_CHARS ? req.snippet : truncate(req.snippet);
    const user = [
      "아래 클래스가 이 저장소에서 맡는 일을 설명하세요. 주요 메서드가 무엇을 하는지, 부르는 쪽과 부르는 것 관점에서 어디에 놓이는지 짚고, 처음 읽는 사람이 먼저 볼 메서드를 알려 주세요.",
      "",
      "## 위치",
      graphSummary,
      "",
      "## 코드",
      fence(kept),
    ].join("\n");
    const { text: _t, ...scope } = kept;
    return {
      kind: "class", title: `${req.name} 설명`, scope: [scope], graphSummary,
      messages: [{ role: "system", content: GUIDE_SYSTEM }, { role: "user", content: user }],
      chars: user.length + GUIDE_SYSTEM.length, omitted: 0, omittedScope: [],
    };
  }
  const graphSummary = capSummary(
    [
      `패키지: ${req.label} (${req.name || "기본 패키지"})`,
      "클래스(역할, 종류, 공개 메서드):",
      ...req.classes.map((c) => `- ${c.name} [${c.role}, ${c.kind}]${c.methods.length ? `: ${c.methods.join(", ")}` : ""}`),
      list("이 패키지가 부르는 패키지(호출 수)", req.dependsOn.map((d) => `${d.label} ${d.calls}`)),
      list("이 패키지를 부르는 패키지(호출 수)", req.usedBy.map((d) => `${d.label} ${d.calls}`)),
    ].filter(Boolean).join("\n"),
  );
  const user = [
    "아래 패키지가 이 저장소에서 맡는 일을 설명하세요. 클래스 목록과 공개 메서드, 다른 패키지와의 연결만 보냈고 메서드 본문은 보내지 않았습니다. 어떤 클래스부터 읽으면 좋을지 짚어 주세요.",
    "",
    "## 구조",
    graphSummary,
  ].join("\n");
  return {
    kind: "package", title: `${req.label} 패키지 설명`, scope: [], graphSummary,
    messages: [{ role: "system", content: GUIDE_SYSTEM }, { role: "user", content: user }],
    chars: user.length + GUIDE_SYSTEM.length, omitted: 0, omittedScope: [],
  };
}

/** 전송할 내용을 만든다(설계 6.3 preview). 네트워크를 쓰지 않는다 */
export function preview(req: ExplainRequest): ExplainPayload {
  if (req.kind === "class" || req.kind === "package") return previewGuide(req);
  if (req.kind === "flow") {
    const f = req.flow;
    const graphSummary = capSummary(
      [`흐름: ${f.label} (진입점 ${f.entry.qualifiedName})`, "단계(호출 순서대로):", ...f.steps.map(stepLine), f.truncated ? "탐색 상한에 걸려 잘린 가지가 있습니다." : ""]
        .filter(Boolean)
        .join("\n"),
    );
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
  const graphSummary = capSummary([
    // 이름은 화면 표기로, 패키지와 클래스는 전체 이름에서 메서드 이름을 뺀 것으로 적는다(생성자가 OrderService.OrderService로 보이지 않게)
    `메서드: ${short(s.symbol)} (${s.symbol.qualifiedName.includes(".") ? `${s.symbol.qualifiedName.slice(0, s.symbol.qualifiedName.lastIndexOf("."))}, ` : ""}${s.symbol.path}) [${tagsOf(s)}]`,
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
    .join("\n"));
  const { kept, omitted, dropped } = fitPair(req.snippet, req.baseSnippet);
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
