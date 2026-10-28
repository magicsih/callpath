import type { EntryKind, FileChange, Flow, ReviewSession, Step, SymbolRef, TestRef } from "@callpath/core";

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
    for (const t of s.tests) if (t.changed) testFiles.add(t.symbol.path);
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

/** 현재 단계에서 바로 이어지는 같은 흐름의 단계(호출 스택에서 부모가 현재 메서드인 단계) */
export function childSteps(item: StepItem, nav: Nav): StepItem[] {
  if (!item.flow) return [];
  const group = nav.groups.find((g) => g.id === item.groupId);
  if (!group) return [];
  const me = sym(item.step.symbol);
  return group.items.filter((i): i is StepItem => {
    if (i.kind !== "step") return false;
    const p = i.step.path;
    return p.length >= 2 && sym(p[p.length - 2]!) === me;
  });
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

/** 생성자와 초기화 블록은 이름 대신 종류로 보인다 */
export function methodLabel(s: SymbolRef): string {
  const cls = s.container?.split(".").pop();
  if (s.name === "constructor" || (cls && s.name === cls)) return "생성자";
  if (s.name === "init") return "init 블록";
  if (s.name === "<spec>") return "스펙 본문";
  return s.name;
}

export function shortName(s: SymbolRef): string {
  const cls = s.container?.split(".").pop();
  const label = methodLabel(s);
  if (!cls) return label;
  return label === s.name ? `${cls}.${label}` : `${cls} ${label}`;
}
