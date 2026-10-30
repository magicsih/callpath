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
  /** 이름으로만 이은 연결 */
  low: boolean;
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

export interface CodeMark {
  /** 파일 기준 줄(1부터) */
  line: number;
  text: string;
  kind: "next" | "back" | "fold";
}

/** 코드 줄 옆에 붙일 표시. 이어지는 단계, 앞 단계를 다시 부름, 접은 메서드를 한 줄에 모은다 */
export function tourMarks(t: Tour, n: number): CodeMark[] {
  const s = stepAt(t, n);
  if (!s) return [];
  const byLine = new Map<number, { next: string[]; back: string[]; fold: string[] }>();
  const at = (line: number) => byLine.get(line) ?? byLine.set(line, { next: [], back: [], fold: [] }).get(line)!;
  for (const c of s.calls) {
    const target = stepAt(t, c.to);
    if (!target) continue;
    if (c.back) at(c.line).back.push(`${c.to}단계`);
    else at(c.line).next.push(`${c.to}단계 ${stepLabel(target)}`);
  }
  for (const f of s.folded) at(f.line).fold.push(f.name);
  return [...byLine]
    .sort(([a], [b]) => a - b)
    .map(([line, m]) => ({
      line: line + 1,
      kind: m.next.length ? "next" : m.back.length ? "back" : "fold",
      text: [
        m.next.length ? `→ ${m.next.join(", ")}` : "",
        m.back.length ? `↩ 앞 ${m.back.join(", ")}` : "",
        m.fold.length ? `접음 ${[...new Set(m.fold)].join(", ")}` : "",
      ].filter(Boolean).join("   "),
    }));
}
