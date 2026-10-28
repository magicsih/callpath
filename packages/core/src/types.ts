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
}

export interface Hunk {
  path: string;
  base: Range | null;
  head: Range | null;
}

export type ChangeKind = "body" | "signature" | "renamed" | "added" | "removed";

export interface CallSite {
  name: string;
  arity: number;
  /** 메서드 본문 블록 기준 중첩 깊이 */
  depth: number;
  /** 가장 가까운 제어문 종류. 없으면 null */
  control: string | null;
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
  confidence: "high" | "medium" | "low";
  tests: SymbolRef[];
  refOf?: { flow: string; n: number };
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
}

export interface ReviewSession {
  repo: string;
  base: string;
  head: string;
  analysis: { fast: "done"; precise: "pending" | "done" | "failed"; failReason?: string };
  flows: Flow[];
  orphans: Step[];
  /** 메서드 밖 변경(필드, import 등)과 지원 언어의 비메서드 hunk */
  outsideMethods: FileChange[];
  otherTests: FileChange[];
  nonCode: FileChange[];
}
