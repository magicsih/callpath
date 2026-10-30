import type { ClassNode, RepoGuide, Role, Tour, TourEntry, TourStep } from "@callpath/core";
import { ROLE_LABEL, displayName } from "@callpath/core/names";

export { ROLE_LABEL };

export const ROLE_ORDER: Role[] = ["entry", "service", "integration", "data", "model", "config", "other"];

export const KIND_LABEL: Record<ClassNode["kind"], string> = {
  class: "클래스", interface: "인터페이스", enum: "enum", record: "record", data: "data class", object: "object", annotation: "애노테이션", file: "Kotlin 파일",
};

export const ENTRY_KIND_LABEL: Record<TourEntry["kind"], string> = {
  http: "HTTP", message: "메시지", schedule: "스케줄", event: "이벤트", grpc: "gRPC", main: "main", api: "공개 API",
};

/** 지도에 보일 역할 열. 클래스가 하나도 없는 역할은 빼서 폭을 아낀다 */
export function mapColumns(g: RepoGuide): Role[] {
  const used = new Set(g.classes.map((c) => c.role));
  return ROLE_ORDER.filter((r) => used.has(r));
}

export interface Neighbor {
  node: ClassNode;
  calls: number;
  /** 이름이나 구현 후보로 이은 연결(연결 불확실) */
  low: boolean;
}

/** 불확실한 연결의 설명. 구현 클래스면 어느 상위 타입의 구현 후보인지 적는다 */
export function linkNote(g: RepoGuide, n: Neighbor): string | null {
  if (!n.low) return null;
  const supers = n.node.supertypeIds.map((id) => g.classes.find((c) => c.id === id)?.name).filter(Boolean);
  return supers.length ? `${supers.join(", ")} 구현 후보` : "연결 불확실";
}

/** 인터페이스면 "구현", 클래스면 "하위 클래스" */
export function subtypeWord(node: ClassNode): string {
  return node.kind === "interface" ? "구현" : "하위 클래스";
}

/** 이 클래스를 상속하거나 구현하는 클래스 */
export function implementors(g: RepoGuide, classId: string): ClassNode[] {
  return g.classes.filter((c) => c.supertypeIds.includes(classId)).sort((a, b) => a.name.localeCompare(b.name));
}

/** 구현 클래스들을 부르는 쪽. 인터페이스를 고르면 실제 호출은 구현으로 이어져 있어 이것을 보인다 */
export function implementorCallers(g: RepoGuide, classId: string): Neighbor[] {
  const impls = new Set(implementors(g, classId).map((c) => c.id));
  if (!impls.size) return [];
  const byId = new Map(g.classes.map((c) => [c.id, c]));
  const acc = new Map<string, Neighbor>();
  for (const l of g.links) {
    if (!impls.has(l.to) || impls.has(l.from) || l.from === classId || !byId.has(l.from)) continue;
    const prev = acc.get(l.from);
    if (prev) prev.calls += l.calls;
    else acc.set(l.from, { node: byId.get(l.from)!, calls: l.calls, low: true });
  }
  return [...acc.values()].sort((a, b) => b.calls - a.calls || a.node.name.localeCompare(b.node.name));
}

/** 고른 클래스를 부르는 쪽과 이 클래스가 부르는 것. 호출 수가 많은 순 */
export function neighbors(g: RepoGuide, classId: string): { callers: Neighbor[]; callees: Neighbor[] } {
  const byId = new Map(g.classes.map((c) => [c.id, c]));
  const sort = (a: Neighbor, b: Neighbor) => b.calls - a.calls || a.node.name.localeCompare(b.node.name);
  const callers: Neighbor[] = [];
  const callees: Neighbor[] = [];
  for (const l of g.links) {
    if (l.to === classId && byId.has(l.from)) callers.push({ node: byId.get(l.from)!, calls: l.calls, low: l.confidence === "low" });
    if (l.from === classId && byId.has(l.to)) callees.push({ node: byId.get(l.to)!, calls: l.calls, low: l.confidence === "low" });
  }
  return { callers: callers.sort(sort), callees: callees.sort(sort) };
}

/** 다른 패키지에서 많이 부르는 클래스 */
export function topClasses(g: RepoGuide, limit = 10): ClassNode[] {
  return g.classes.filter((c) => c.fanIn > 0).sort((a, b) => b.fanIn - a.fanIn || a.name.localeCompare(b.name)).slice(0, limit);
}

export function stepAt(t: Tour, n: number): TourStep | null {
  return t.steps[n - 1] ?? null;
}

/** 진입점부터 이 단계까지 부른 차례 */
export function ancestry(t: Tour, n: number): TourStep[] {
  const out: TourStep[] = [];
  for (let s = stepAt(t, n); s; s = s.parent ? stepAt(t, s.parent) : null) out.unshift(s);
  return out;
}

/** 이 단계에서 이어지는 새 단계. 첫째가 Enter로 갈 곳이다 */
export function childSteps(t: Tour, n: number): Array<{ step: TourStep; line: number }> {
  const s = stepAt(t, n);
  if (!s) return [];
  return s.calls.filter((c) => !c.back).map((c) => ({ step: stepAt(t, c.to)!, line: c.line })).filter((c) => c.step);
}

export function stepLabel(s: TourStep): string {
  return displayName(s.symbol);
}

/** 투어 안에서 이름이 겹치는 단계(오버로드)는 매개변수 타입을, 그래도 겹치면(다른 패키지의 같은 이름 클래스) 패키지 마지막 마디를 붙인다 */
export function stepName(t: Tour, s: TourStep): string {
  const label = stepLabel(s);
  const others = t.steps.filter((x) => x !== s && stepLabel(x) === label);
  if (!others.length) return label;
  const withParams = `${label}(${s.params.join(", ")})`;
  if (!others.some((x) => x.params.join() === s.params.join())) return withParams;
  const parts = s.symbol.qualifiedName.split(".");
  const pkg = parts[parts.length - 1 - (s.symbol.container?.split(".").length ?? 0) - 1];
  return pkg ? `${pkg}.${withParams}` : withParams;
}

/** 갈래 표시. 목록에는 짧게, 제목에는 길게 */
export function branchText(s: TourStep, long: boolean): string | null {
  if (s.alternatives < 2) return null;
  if (s.branch === "overloads") return long ? `오버로드 ${s.alternatives}개 중 매개변수 타입이 가장 맞는 하나` : "오버로드";
  const kind = s.branch === "implementations" ? "구현" : "같은 이름 후보";
  return long ? `${kind} ${s.alternatives}개 중 하나` : s.branch === "implementations" ? "갈래" : kind;
}

export interface CodeMark {
  /** 파일 기준 줄(1부터) */
  line: number;
  text: string;
  /** next: 이어지는 단계, back: 앞 단계를 다시 부름, fold: 접은 메서드, ext: 물려받거나 자동으로 생긴 메서드 */
  kind: "next" | "back" | "fold" | "ext";
  /** 누르면 갈 단계 */
  to?: number;
}

/** 접은 메서드 이름. 투어 안에 이름은 같고 매개변수가 다른 것이 있으면 매개변수를 붙인다 */
export function foldName(t: Tour, f: TourStep["folded"][number]): string {
  const clash = t.steps.some((s) => s.folded.some((x) => x.name === f.name && x.params.join() !== f.params.join()));
  return clash && f.params.length ? `${f.name}(${f.params.join(", ")})` : f.name;
}

/** 코드 줄 옆에 붙일 표시. 이어지는 단계는 단계마다 따로(눌러서 그 단계로), 나머지는 줄마다 한데 모은다 */
export function tourMarks(t: Tour, n: number): CodeMark[] {
  const s = stepAt(t, n);
  if (!s) return [];
  const lines = new Set<number>();
  const out: CodeMark[] = [];
  const next = new Map<number, CodeMark[]>();
  const back = new Map<number, number[]>();
  const fold = new Map<number, string[]>();
  const ext = new Map<number, string[]>();
  const push = <V>(m: Map<number, V[]>, line: number, v: V) => {
    lines.add(line);
    (m.get(line) ?? m.set(line, []).get(line)!).push(v);
  };
  for (const c of s.calls) {
    const target = stepAt(t, c.to);
    if (!target) continue;
    if (c.back) push(back, c.line, c.to);
    else push(next, c.line, { line: c.line + 1, kind: "next", to: c.to, text: `→ ${c.to}단계 ${stepName(t, target)}` });
  }
  for (const f of s.folded) push(fold, f.line, foldName(t, f));
  for (const f of s.external) push(ext, f.line, f.name);
  for (const line of [...lines].sort((a, b) => a - b)) {
    out.push(...(next.get(line) ?? []));
    const b = back.get(line);
    if (b) out.push({ line: line + 1, kind: "back", to: b[0]!, text: `↩ 앞 ${[...new Set(b)].map((x) => `${x}단계`).join(", ")}` });
    const fo = fold.get(line);
    if (fo) out.push({ line: line + 1, kind: "fold", text: `접음 ${[...new Set(fo)].join(", ")}` });
    const ex = ext.get(line);
    if (ex) out.push({ line: line + 1, kind: "ext", text: `↗ ${[...new Set(ex)].join(", ")}` });
  }
  return out;
}

