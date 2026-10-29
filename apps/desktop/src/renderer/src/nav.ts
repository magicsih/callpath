import type { EntryKind, FileChange, Flow, ReviewSession, Step, SymbolRef, TestRef } from "@callpath/core";
import { displayName as shortName, methodLabel } from "@callpath/core/names";

export type GroupKind = EntryKind | "orphans" | "outside" | "otherTests" | "nonCode";

interface Base {
  key: string;
  groupId: string;
}

export interface StepItem extends Base {
  kind: "step";
  step: Step;
  flow: Flow | null;
  /** 묶음 안 순서, 1부터 */
  pos: number;
  total: number;
}

export interface TestItem extends Base {
  kind: "test";
  parentKey: string;
  test: TestRef;
  step: Step;
}

export interface FileItem extends Base {
  kind: "file";
  file: FileChange;
  pos: number;
  total: number;
}

export type NavItem = StepItem | TestItem | FileItem;

export interface NavGroup {
  id: string;
  kind: GroupKind;
  label: string;
  items: Array<StepItem | FileItem>;
}

export interface Nav {
  groups: NavGroup[];
  /** 이전, 다음으로 따라가는 순서. 테스트 표시를 켜면 단계 바로 뒤에 그 단계의 테스트가 온다 */
  order: NavItem[];
  testsOf: Map<string, TestItem[]>;
  /** 테스트 표시를 끄면 보이지 않는 테스트 파일 수 */
  hiddenTestFiles: number;
}

const sym = (s: SymbolRef) => `${s.qualifiedName}@${s.range.startLine}`;

export function buildNav(session: ReviewSession, showTests: boolean): Nav {
  const groups: NavGroup[] = [];
  const testsOf = new Map<string, TestItem[]>();

  const stepItems = (groupId: string, steps: Step[], flow: Flow | null): StepItem[] =>
    steps.map((step, i) => {
      const key = `${groupId}|${sym(step.symbol)}|${step.change}`;
      if (step.tests.length) {
        testsOf.set(key, step.tests.map((test) => ({ kind: "test", key: `${key}|t|${sym(test.symbol)}`, groupId, parentKey: key, test, step })));
      }
      return { kind: "step", key, groupId, step, flow, pos: i + 1, total: steps.length };
    });

  for (const flow of session.flows) {
    const id = `flow:${flow.label}`;
    groups.push({ id, kind: flow.kind, label: flow.label, items: stepItems(id, flow.steps, flow) });
  }
  if (session.orphans.length) groups.push({ id: "orphans", kind: "orphans", label: "진입점 미확정", items: stepItems("orphans", session.orphans, null) });

  const fileGroup = (id: "outside" | "otherTests" | "nonCode", label: string, files: FileChange[]) => {
    if (!files.length) return;
    groups.push({
      id,
      kind: id,
      label,
      items: files.map((file, i) => ({ kind: "file", key: `${id}|${file.path}`, groupId: id, file, pos: i + 1, total: files.length })),
    });
  };
  fileGroup("outside", "메서드 밖 변경", session.outsideMethods);
  if (showTests) fileGroup("otherTests", "기타 테스트", session.otherTests);
  fileGroup("nonCode", "기타 파일", session.nonCode);

  const order: NavItem[] = [];
  for (const g of groups) {
    for (const item of g.items) {
      order.push(item);
      if (showTests && item.kind === "step") order.push(...(testsOf.get(item.key) ?? []));
    }
  }

  const testFiles = new Set<string>();
  for (const s of [...session.flows.flatMap((f) => f.steps), ...session.orphans]) {
    for (const t of s.tests) if (t.change !== null) testFiles.add(t.symbol.path);
  }
  for (const f of session.otherTests) testFiles.add(f.path);

  return { groups, order, testsOf, hiddenTestFiles: showTests ? 0 : testFiles.size };
}

/** 저장해 둔 키가 없으면(테스트 표시를 끈 뒤의 테스트 항목 등) 부모 단계나 첫 항목으로 돌아간다 */
export function resolveSelection(nav: Nav, key: string | null): NavItem | null {
  if (!nav.order.length) return null;
  if (key) {
    const hit = nav.order.find((i) => i.key === key);
    if (hit) return hit;
    const parent = key.includes("|t|") ? nav.order.find((i) => i.key === key.slice(0, key.indexOf("|t|"))) : undefined;
    if (parent) return parent;
  }
  return nav.order[0]!;
}

export function neighbor(nav: Nav, key: string, delta: 1 | -1): NavItem | null {
  const i = nav.order.findIndex((x) => x.key === key);
  if (i < 0) return nav.order[0] ?? null;
  return nav.order[i + delta] ?? null;
}

export interface NextStep {
  item: StepItem;
  /** 현재 단계와 다음 단계 사이에 지나는 바뀌지 않은 메서드 */
  via: SymbolRef[];
}

/**
 * 현재 단계에서 이어지는 같은 흐름의 가장 가까운 다음 단계들. 사이에 바뀌지 않은 메서드만 있으면
 * 그것을 건너뛰고(경유), 다른 단계를 거쳐야 닿는 것은 그 단계의 다음 단계라 넣지 않는다.
 */
export function nextSteps(item: StepItem, nav: Nav): NextStep[] {
  if (!item.flow) return [];
  const group = nav.groups.find((g) => g.id === item.groupId);
  if (!group) return [];
  const me = sym(item.step.symbol);
  const stepKeys = new Set(group.items.filter((i) => i.kind === "step").map((i) => sym((i as StepItem).step.symbol)));
  const out: NextStep[] = [];
  for (const i of group.items) {
    if (i.kind !== "step" || i === item) continue;
    const p = i.step.path;
    const at = p.findIndex((x) => sym(x) === me);
    if (at < 0 || at >= p.length - 1) continue;
    const via = p.slice(at + 1, p.length - 1);
    if (via.some((x) => stepKeys.has(sym(x)))) continue;
    out.push({ item: i, via });
  }
  return out;
}

/** 이어지는 단계 중 첫 번째(Enter로 가는 곳) */
export function childSteps(item: StepItem, nav: Nav): StepItem[] {
  return nextSteps(item, nav).map((n) => n.item);
}

/** 호출 스택의 한 칸이 이 흐름의 단계면 그 항목, 바뀌지 않은 경유 메서드면 null */
export function stepForStackEntry(entry: SymbolRef, item: StepItem, nav: Nav): StepItem | null {
  const group = nav.groups.find((g) => g.id === item.groupId);
  const k = sym(entry);
  return (group?.items.find((i) => i.kind === "step" && sym(i.step.symbol) === k) as StepItem | undefined) ?? null;
}

/** 참조 단계(refOf)가 가리키는 원래 단계 */
export function refTarget(item: StepItem, nav: Nav, session: ReviewSession): StepItem | null {
  const ref = item.step.refOf;
  if (!ref) return null;
  const flow = session.flows.find((f) => f.id === ref.flow);
  if (!flow) return null;
  const group = nav.groups.find((g) => g.id === `flow:${flow.label}`);
  return (group?.items.find((i) => i.kind === "step" && i.pos === ref.n) as StepItem | undefined) ?? null;
}

export const CHANGE_LABEL: Record<Step["change"], string> = {
  body: "본문",
  signature: "시그니처",
  renamed: "이름",
  added: "추가",
  removed: "삭제",
  unchanged: "진입점",
};

/** 이동한 호출을 사람이 읽는 문장으로. 예: approve 호출이 decrease 다음으로 옮겨졌습니다 */
export function describeMoves(step: Step): string[] {
  const d = step.callOrderDiff;
  if (!d) return [];
  return d.moved.map((hi) => {
    const c = d.head[hi]!;
    // 인자 안의 호출(decrease(request.items())의 items)은 건너뛰고, 앞 줄의 가장 바깥 호출을 기준으로 삼는다
    const before = d.head.slice(0, hi).filter((x) => x.line < c.line);
    const prevLine = before.length ? Math.max(...before.map((x) => x.line)) : -1;
    const prev = before.find((x) => x.line === prevLine);
    return prev ? `${c.name} 호출이 ${prev.name} 다음으로 옮겨졌습니다` : `${c.name} 호출이 맨 앞으로 옮겨졌습니다`;
  });
}

// 이름 표기 규칙은 LLM에 보내는 내용과 같아야 해서 코어에 둔다. 화면에는 Node 모듈이 없는 가벼운 입구(names)로 불러온다
export { methodLabel, shortName };
