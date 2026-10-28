import type { CallGraph, Confidence } from "../graph/callGraph.js";
import type { MethodSymbol } from "../index/symbols.js";
import type { EntryKind, Flow, Step, SymbolRef } from "../types.js";
import type { EntryPoint } from "./entries.js";

/** 마지막으로 지난 바뀐 메서드(또는 진입점) 뒤로 연속해서 따라갈 바뀌지 않은 메서드 수의 상한 */
export const MAX_DEPTH = 12;
export const MAX_TRANSIT = 200;

const KIND_ORDER: EntryKind[] = ["http", "message", "schedule", "event", "grpc", "main", "unknown"];
const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

export function toRef(m: Pick<MethodSymbol, "path" | "qualifiedName" | "name" | "container" | "arity" | "range">): SymbolRef {
  return { path: m.path, qualifiedName: m.qualifiedName, name: m.name, container: m.container, arity: m.arity, range: m.range };
}

function minConfidence(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

interface Visit {
  id: string;
  path: string[];
  confidence: Confidence;
}

/**
 * 설계 5.4 흐름 정렬. 진입점에서 호출문의 소스 순서대로 깊이 우선 탐색하고, 바뀐 메서드만 단계로 센다.
 * 진입점은 바뀌지 않았어도 1단계로 둔다. 바뀐 메서드가 하나도 닿지 않는 진입점은 흐름을 만들지 않는다.
 */
export function buildFlows(
  graph: CallGraph,
  entries: EntryPoint[],
  changed: Map<string, Step>,
  isTestId: (id: string) => boolean,
): { flows: Flow[]; claimed: Set<string> } {
  const walked = entries
    .map((entry) => ({ entry, ...walk(graph, entry.id, changed, isTestId) }))
    .filter((w) => w.visits.some((v) => changed.has(v.id)));

  walked.sort((a, b) => {
    const k = KIND_ORDER.indexOf(a.entry.kind) - KIND_ORDER.indexOf(b.entry.kind);
    if (k) return k;
    const n = countChanged(b.visits, changed) - countChanged(a.visits, changed);
    return n || a.entry.label.localeCompare(b.entry.label);
  });

  const owner = new Map<string, { flow: string; n: number }>();
  const flows: Flow[] = walked.map((w, fi) => {
    const flowId = `f${fi + 1}`;
    const steps: Step[] = w.visits.map((v, si) => {
      const n = si + 1;
      const pathRefs = v.path.map((id) => toRef(graph.methods.get(id)!));
      const base = changed.get(v.id);
      const step: Step = base
        ? { ...base, n, path: pathRefs, confidence: v.confidence, tests: [] }
        : {
            n, symbol: toRef(graph.methods.get(v.id)!), baseSymbol: null, change: "unchanged", hunks: [], path: pathRefs,
            signatureChanged: false, confidence: v.confidence, tests: [],
          };
      const prior = owner.get(v.id);
      if (prior) step.refOf = prior;
      else if (base) owner.set(v.id, { flow: flowId, n });
      return step;
    });
    const entry = w.entry;
    return { id: flowId, kind: entry.kind, label: entry.label, entry: toRef(entry.method), steps, truncated: w.truncated };
  });
  return { flows, claimed: new Set(owner.keys()) };
}

function countChanged(visits: Visit[], changed: Map<string, Step>): number {
  return visits.filter((v) => changed.has(v.id)).length;
}

function walk(graph: CallGraph, entryId: string, changed: Map<string, Step>, isTestId: (id: string) => boolean): { visits: Visit[]; truncated: boolean } {
  const visits: Visit[] = [];
  const seen = new Set<string>();
  let transit = 0;
  let truncated = false;

  // depth는 마지막 바뀐 메서드 이후 연속으로 지난 바뀌지 않은 메서드 수다. 바뀐 메서드를 만나면 0으로 돌아간다.
  const visit = (id: string, path: string[], confidence: Confidence, depth: number): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const here = [...path, id];
    let d = depth;
    if (id === entryId || changed.has(id)) {
      visits.push({ id, path: here, confidence });
      d = 0;
    } else if (++transit > MAX_TRANSIT) { truncated = true; return; }
    const edges = graph.outgoing(id).filter((e) => !isTestId(e.callee));
    if (d >= MAX_DEPTH) { if (edges.length) truncated = true; return; }
    for (const e of [...edges].sort((a, b) => a.callIndex - b.callIndex)) {
      visit(e.callee, here, minConfidence(confidence, e.confidence), d + 1);
    }
  };
  visit(entryId, [], "high", 0);
  return { visits, truncated };
}
