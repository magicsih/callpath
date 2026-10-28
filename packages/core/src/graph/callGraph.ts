import type { ClassSymbol, FileIndex, MethodSymbol } from "../index/symbols.js";
import type { CallSite } from "../types.js";

export type Confidence = "high" | "medium" | "low";

export interface Edge {
  caller: string;
  callee: string;
  /** caller 본문에서 호출문의 순서 */
  callIndex: number;
  confidence: Confidence;
  source: "tree-sitter" | "lsp";
}

/** 같은 이름 후보가 이보다 많으면 이름만으로 잇지 않는다 (get, run, apply 같은 흔한 이름) */
const MAX_NAME_ONLY_CANDIDATES = 8;

export function methodId(m: Pick<MethodSymbol, "path" | "qualifiedName" | "range">): string {
  return `${m.path}#${m.qualifiedName}@${m.range.startLine}`;
}

export class CallGraph {
  readonly methods = new Map<string, MethodSymbol>();
  readonly classes = new Map<string, ClassSymbol>();
  private readonly out = new Map<string, Edge[]>();
  private readonly inc = new Map<string, Edge[]>();

  outgoing(id: string): Edge[] {
    return this.out.get(id) ?? [];
  }

  incoming(id: string): Edge[] {
    return this.inc.get(id) ?? [];
  }

  addEdge(e: Edge): void {
    push(this.out, e.caller, e);
    push(this.inc, e.callee, e);
  }

  /** 정밀 분석(LSP)이 질의한 caller의 간선을 교체한다. 설계 5.2 병합 규칙. */
  replaceOutgoing(caller: string, edges: Edge[]): void {
    for (const e of this.outgoing(caller)) {
      const list = this.inc.get(e.callee);
      if (list) this.inc.set(e.callee, list.filter((x) => x !== e));
    }
    this.out.delete(caller);
    for (const e of edges) this.addEdge(e);
  }
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V): void {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
}

/** 설계 5.2의 1계층: tree-sitter 결과만으로 이름, 인자 수, 수신자 타입을 써서 호출 간선을 만든다. */
export function buildCallGraph(files: FileIndex[]): CallGraph {
  const g = new CallGraph();
  const byName = new Map<string, MethodSymbol[]>();
  const byClass = new Map<string, MethodSymbol[]>();
  const classesBySimpleName = new Map<string, ClassSymbol[]>();
  const implementors = new Map<string, ClassSymbol[]>();

  for (const f of files) {
    for (const c of f.classes) {
      g.classes.set(c.qualifiedName, c);
      push(classesBySimpleName, c.name, c);
      for (const s of c.supertypes) push(implementors, s, c);
    }
    for (const m of f.methods) {
      g.methods.set(methodId(m), m);
      if (m.synthetic) continue;
      push(byName, m.name, m);
      if (m.classQualifiedName) push(byClass, m.classQualifiedName, m);
    }
  }

  const methodsOf = (c: ClassSymbol, name: string): MethodSymbol[] => (byClass.get(c.qualifiedName) ?? []).filter((m) => m.name === name);

  /** 클래스와 그 상위 클래스에서 이름이 같은 메서드. 상위 타입은 저장소 안에 있는 것만 따라간다. */
  const lookupInHierarchy = (c: ClassSymbol, name: string, seen = new Set<string>()): MethodSymbol[] => {
    if (seen.has(c.qualifiedName)) return [];
    seen.add(c.qualifiedName);
    const own = methodsOf(c, name);
    if (own.length) return own;
    return c.supertypes.flatMap((s) => (classesBySimpleName.get(s) ?? []).flatMap((p) => lookupInHierarchy(p, name, seen)));
  };

  const resolveOnType = (type: string, name: string): { candidates: MethodSymbol[]; viaImplementors: boolean } | null => {
    const classes = classesBySimpleName.get(type);
    if (!classes) return null; // 저장소 밖 타입 (List, String 등)
    const direct = classes.flatMap((c) => lookupInHierarchy(c, name));
    if (direct.some((m) => m.body)) return { candidates: direct, viaImplementors: false };
    // 인터페이스나 추상 메서드면 구현 클래스의 메서드로 잇는다
    const impls = (implementors.get(type) ?? []).flatMap((c) => methodsOf(c, name));
    return impls.length ? { candidates: impls, viaImplementors: true } : { candidates: direct, viaImplementors: false };
  };

  for (const caller of g.methods.values()) {
    const callerClass = caller.classQualifiedName ? g.classes.get(caller.classQualifiedName) ?? null : null;
    caller.calls.forEach((call, callIndex) => {
      const resolved = resolveCall(call, caller, callerClass);
      for (const callee of resolved.targets) {
        g.addEdge({ caller: methodId(caller), callee: methodId(callee), callIndex, confidence: resolved.confidence, source: "tree-sitter" });
      }
    });
  }
  return g;

  function resolveCall(call: CallSite, caller: MethodSymbol, callerClass: ClassSymbol | null): { targets: MethodSymbol[]; confidence: Confidence } {
    const none = { targets: [], confidence: "low" as Confidence };

    // Java 생성자 호출: new X(...) → X의 생성자
    if (call.name.startsWith("new ")) {
      const type = call.name.slice(4);
      const ctors = (classesBySimpleName.get(type) ?? []).flatMap((c) => methodsOf(c, type));
      return pick(ctors, call.arity, false);
    }

    let type: string | null = null;
    if (call.receiver === null || call.receiver === "this") {
      if (callerClass) {
        const own = lookupInHierarchy(callerClass, call.name);
        if (own.length) return pick(own, call.arity, false);
      }
      if (call.receiver === "this") return none;
      // Kotlin에서 대문자로 시작하고 저장소에 같은 이름 클래스가 있으면 생성자 호출이다
      if (/^[A-Z]/.test(call.name) && classesBySimpleName.has(call.name)) return none;
      const topLevel = (byName.get(call.name) ?? []).filter((m) => m.classQualifiedName === null || m.isStatic);
      return pickNameOnly(topLevel, call.arity);
    }
    if (call.receiver === "super") {
      const parents = (callerClass?.supertypes ?? []).flatMap((s) => classesBySimpleName.get(s) ?? []);
      return pick(parents.flatMap((p) => lookupInHierarchy(p, call.name)), call.arity, false);
    }
    if (call.receiver !== "?") {
      const r = call.receiver;
      const param = caller.params.find((p) => p.name === r)?.type;
      type = caller.locals[r] ?? param ?? callerClass?.fields[r] ?? null;
      // 대문자 수신자는 정적 호출이나 object 선언으로 본다
      if (!type && /^[A-Z]/.test(r)) type = r;
    }
    if (type) {
      const res = resolveOnType(type, call.name);
      if (!res) return none;
      return pick(res.candidates, call.arity, res.viaImplementors);
    }
    return pickNameOnly(byName.get(call.name) ?? [], call.arity);
  }
}

function filterArity(candidates: MethodSymbol[], arity: number): { list: MethodSymbol[]; exact: boolean } {
  const exact = candidates.filter((m) => m.arity === arity);
  // Kotlin 기본 인자나 가변 인자처럼 수가 다른 경우가 있어 맞는 것이 없으면 이름만 같은 것을 낮은 신뢰도로 남긴다
  return exact.length ? { list: exact, exact: true } : { list: candidates, exact: false };
}

/** 수신자 타입을 알고 고른 후보 */
function pick(candidates: MethodSymbol[], arity: number, viaImplementors: boolean): { targets: MethodSymbol[]; confidence: Confidence } {
  const { list, exact } = filterArity(candidates, arity);
  const confidence: Confidence = list.length === 1 && exact && !viaImplementors ? "medium" : "low";
  return { targets: list, confidence };
}

/** 수신자 타입을 모르고 이름만으로 고른 후보 */
function pickNameOnly(candidates: MethodSymbol[], arity: number): { targets: MethodSymbol[]; confidence: Confidence } {
  const { list, exact } = filterArity(candidates, arity);
  if (list.length === 0 || list.length > MAX_NAME_ONLY_CANDIDATES) return { targets: [], confidence: "low" };
  return { targets: list, confidence: list.length === 1 && exact ? "medium" : "low" };
}
