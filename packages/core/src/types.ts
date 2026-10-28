/** 설계 6.1 ReviewSession 스키마. 1단계에서는 flows를 만들지 않고 모든 변경 메서드를 orphans에 둔다. */

export type Language = "java" | "kotlin";

export interface Range {
  /** 0부터 시작하는 줄 번호, 끝 줄 포함 */
  startLine: number;
  endLine: number;
}

export interface SymbolRef {
  path: string;
  /** 예: shop.order.OrderService.placeOrder */
  qualifiedName: string;
  name: string;
  container: string | null;
  arity: number;
  range: Range;
  /** 메서드 이름이 시작하는 위치(0부터). LSP 질의에 쓴다 */
  namePos?: { line: number; column: number };
}

export interface Hunk {
  path: string;
  base: Range | null;
  head: Range | null;
}

/** unchanged는 바뀌지 않았지만 흐름의 시작점이라 1단계로 보여주는 진입점이다 */
export type ChangeKind = "body" | "signature" | "renamed" | "added" | "removed" | "unchanged";

export interface CallSite {
  name: string;
  arity: number;
  /** 수신자. 단순 식별자면 그 이름, this/super, 복잡한 식이면 "?", 수신자 없으면 null */
  receiver: string | null;
  /** 메서드 본문 블록 기준 중첩 깊이 */
  depth: number;
  /** 가장 가까운 제어문 종류. 없으면 null */
  control: string | null;
  /** 다른 호출의 인자나 수신자 안에 있는 호출. 예: decrease(request.items())의 items */
  nested: boolean;
  line: number;
}

export interface CallOrderDiff {
  base: CallSite[];
  head: CallSite[];
  /** head 인덱스 */
  moved: number[];
  added: number[];
  /** base 인덱스 */
  removed: number[];
  /** 이동한 호출 중 블록 깊이나 제어문이 달라진 것 (head 인덱스) */
  movedAcrossBlock: number[];
  /** 짝지은 호출 중 인자 수가 달라진 것 (head 인덱스) */
  arityChanged: number[];
}

export interface Step {
  n: number;
  symbol: SymbolRef;
  baseSymbol: SymbolRef | null;
  change: ChangeKind;
  hunks: Hunk[];
  path: SymbolRef[];
  callOrderDiff?: CallOrderDiff;
  /** 매개변수, 반환 타입, 애노테이션 같은 시그니처가 바뀜. change가 body여도 함께 켜질 수 있다 */
  signatureChanged: boolean;
  /** 진입점부터 이 단계까지 지난 간선 중 가장 낮은 신뢰도 */
  confidence: "high" | "medium" | "low";
  /** 이 메서드를 직접 호출하는 테스트. 바뀐 테스트가 앞에 온다 */
  tests: TestRef[];
  /** 앞선 흐름에서 이미 단계로 나온 메서드면 그 위치 */
  refOf?: { flow: string; n: number };
}

export interface TestRef {
  symbol: SymbolRef;
  /** 바뀐 테스트의 base 쪽 짝. 새로 생겼거나 바뀌지 않았으면 null */
  baseSymbol: SymbolRef | null;
  /** 이 테스트의 변경 종류. 바뀌지 않았으면 null */
  change: Exclude<ChangeKind, "removed" | "unchanged"> | null;
  /** 이 테스트 메서드 범위에 걸친 변경 hunk */
  hunks: Hunk[];
  confidence: "high" | "medium" | "low";
}

export interface FileChange {
  path: string;
  status: "added" | "removed" | "modified";
  language: Language | null;
  isTest: boolean;
  hunks: Hunk[];
}

export type EntryKind = "http" | "message" | "schedule" | "event" | "grpc" | "main" | "unknown";

export interface Flow {
  id: string;
  kind: EntryKind;
  label: string;
  entry: SymbolRef;
  steps: Step[];
  /** 탐색 깊이나 경유 메서드 상한에 걸려 잘린 가지가 있음 */
  truncated: boolean;
}

/** 정밀 분석(LSP) 상태. skipped는 도구가 없거나 꺼져 있어 하지 않은 것 */
export type PreciseStatus = "pending" | "done" | "failed" | "skipped";

export interface LanguageAnalysis {
  status: PreciseStatus;
  /** disabled: 설정으로 끔, no-tool: JDK나 kotlin-lsp가 없음, error: 실행 오류, timeout: 시간 초과 */
  code?: "disabled" | "no-tool" | "error" | "timeout";
  /** 실패하거나 건너뛴 이유 */
  reason?: string;
  /** 질의한 바뀐 메서드 수와 확인한 간선 수 */
  queried?: number;
  confirmedEdges?: number;
}

export interface ReviewSession {
  repo: string;
  base: string;
  head: string;
  analysis: {
    fast: "done";
    precise: PreciseStatus;
    /** 언어별 정밀 분석 결과. 바뀐 메서드가 있는 언어만 들어간다 */
    languages: Partial<Record<Language, LanguageAnalysis>>;
  };
  flows: Flow[];
  orphans: Step[];
  /** 메서드 밖 변경(필드, import 등)과 지원 언어의 비메서드 hunk */
  outsideMethods: FileChange[];
  /** 어떤 변경 메서드에도 붙지 않은 테스트 변경 */
  otherTests: FileChange[];
  nonCode: FileChange[];
  stats: { files: number; methods: number; edges: number; entries: number; ms: number };
}
