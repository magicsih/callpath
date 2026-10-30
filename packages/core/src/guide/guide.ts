import { indexSource } from "../analyze.js";
import { isTestFile } from "../classify/test.js";
import { loadConfig, type CallpathConfig, type Role } from "../config.js";
import { languageOf } from "../diff/fileChanges.js";
import { detectEntries } from "../flow/entries.js";
import { toRef } from "../flow/flows.js";
import { buildCallGraph, type CallGraph, type Confidence } from "../graph/callGraph.js";
import type { ClassKind, ClassSymbol, FileIndex, MethodSymbol } from "../index/symbols.js";
import { displayName } from "../names.js";
import type { FileSource } from "../source/fileSource.js";
import type { EntryKind, Range, SymbolRef } from "../types.js";
import { roleOf } from "./roles.js";

/** 이보다 코드 파일이 많으면 시작 전에 알리고 디렉터리로 좁히게 한다 (설계 7단계 6절) */
export const LARGE_REPO_FILES = 3000;
export const MAX_TOUR_DEPTH = 8;
export const MAX_TOUR_STEPS = 60;
/** 진입점이 없을 때 공개 API 투어로 쓸 클래스 수와 클래스마다 고를 메서드 수 (D19) */
export const MAX_API_CLASSES = 20;
const API_METHODS_PER_CLASS = 3;

const KIND_ORDER: TourEntryKind[] = ["http", "message", "schedule", "event", "grpc", "main", "api"];
const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

export type TourEntryKind = Exclude<EntryKind, "unknown"> | "api";

export interface PackageNode {
  name: string;
  /** 모든 패키지에 공통인 앞부분을 뗀 이름. 공통 앞부분 자체인 패키지는 마지막 마디 */
  label: string;
  files: number;
  classIds: string[];
}

export interface ClassNode {
  /** 클래스는 qualifiedName, Kotlin 최상위 함수 파일은 file:경로 */
  id: string;
  name: string;
  packageName: string;
  path: string;
  kind: ClassKind | "file";
  role: Role;
  range: Range;
  methods: number;
  /** 다른 패키지에서 이 클래스 메서드를 부르는 간선 수. 이름으로만 이은 간선은 0.5 */
  fanIn: number;
  /** 이 클래스를 부르는 테스트 메서드 수 */
  tests: number;
  /** 이 클래스에 선언된 진입점 */
  entryIds: string[];
  /** 저장소 안에서 이 클래스가 상속하거나 구현하는 클래스와 인터페이스 */
  supertypeIds: string[];
}

export interface ClassLink {
  from: string;
  to: string;
  calls: number;
  /** 두 클래스 사이 간선 중 가장 높은 신뢰도. low면 이름이나 인터페이스 구현 후보로 추정한 연결이다 */
  confidence: Confidence;
}

export interface TourEntry {
  id: string;
  kind: TourEntryKind;
  label: string;
  classId: string;
  symbol: SymbolRef;
}

export interface RepoGuide {
  ref: string;
  sha: string;
  /** 좁혀 둘러본 디렉터리. 없으면 저장소 전체 */
  dir: string | null;
  stats: { files: number; generated: number; classes: number; methods: number; edges: number; entries: number; ms: number };
  packages: PackageNode[];
  classes: ClassNode[];
  links: ClassLink[];
  entries: TourEntry[];
  /** 진입점 규칙에 맞는 메서드가 없어 entries가 공개 API 진입점이다 */
  noEntries: boolean;
}

export interface TourCall {
  /** 이 단계 본문에서 호출이 있는 줄(0부터) */
  line: number;
  to: number;
  /** 이 투어에서 앞에 이미 나온 단계를 다시 부른다 */
  back: boolean;
}

export interface TourStep {
  n: number;
  symbol: SymbolRef;
  classId: string;
  /** 진입점이 0 */
  depth: number;
  /** 이 단계를 부른 단계 */
  parent: number | null;
  /** 부른 단계 본문의 호출 줄 */
  line: number | null;
  /** 같은 호출이 이어지는 후보 수. 2 이상이면 갈래다 */
  alternatives: number;
  /** 갈래의 종류. implementations: 같은 상위 타입의 구현들, overloads: 한 클래스의 같은 이름 메서드들, candidates: 이름만 같은 메서드들 */
  branch: "implementations" | "overloads" | "candidates" | null;
  /** 매개변수 타입(배열과 가변 인자 표시 포함). 같은 이름 메서드를 구별할 때 쓴다 */
  params: string[];
  /** 본문이 없는 추상 메서드(구현이 저장소에 없음) */
  abstract: boolean;
  confidence: Confidence;
  calls: TourCall[];
  /** 이 단계에서 부르는 사소한 메서드와 선언 없는 생성자(record 등). 단계로 세지 않는다 */
  folded: TourFold[];
  /** 저장소 안 타입에 부르지만 선언이 저장소에 없는 메서드(JpaRepository.save 같은 물려받은 메서드, record 접근자) */
  external: TourFold[];
}

export interface TourFold {
  line: number;
  name: string;
  params: string[];
  classId: string;
}

export interface Tour {
  entry: TourEntry;
  steps: TourStep[];
  /** 접은 사소한 메서드 수 */
  collapsed: number;
  truncated: boolean;
}

export type GuideProgress = { stage: "read"; done: number; total: number } | { stage: "link" } | { stage: "map" };

export interface GuideOptions {
  ref: string;
  sha: string;
  dir?: string;
  config?: CallpathConfig;
  onProgress?: (p: GuideProgress) => void;
}

export interface GuideResult {
  guide: RepoGuide;
  /** 진입점 하나의 투어. 처음 부를 때 만들고 기억한다 */
  tour(entryId: string): Tour;
  /** 투어의 단계나 접은 메서드에 이 클래스가 나오는 진입점. 인터페이스나 상위 클래스면 구현 클래스가 나오는 것도 센다 */
  entriesThrough(classId: string): string[];
}

/** 빌드 산출물과 생성 코드 경로. src 앞의 build, target, out과 이름에 generated가 든 디렉터리 */
export function isGeneratedPath(path: string): boolean {
  const parts = path.split("/").slice(0, -1);
  const src = parts.indexOf("src");
  return parts.some((p, i) => (/^(build|target|out)$/.test(p) && (src < 0 || i < src)) || /generated/i.test(p));
}

export function isLargeRepo(files: number): boolean {
  return files > LARGE_REPO_FILES;
}

/** 둘러볼 코드 파일과 생성 코드 경로라서 뺀 파일 수. dir을 주면 그 디렉터리 아래만 */
export async function listGuideFiles(source: FileSource, dir?: string): Promise<{ paths: string[]; generated: number }> {
  const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
  const code = (await source.listFiles()).filter((p) => languageOf(p) !== null && p.startsWith(prefix));
  const paths = code.filter((p) => !isGeneratedPath(p));
  return { paths, generated: code.length - paths.length };
}

/**
 * 큰 저장소를 좁힐 디렉터리 후보. 코드 파일이 한 디렉터리로만 이어지는 동안 내려가다가(src/main/java/com/x 같은)
 * 처음 갈라지는 곳의 하위 디렉터리를 파일 수가 많은 순으로 준다. 멀티 모듈이면 모듈 디렉터리가 나온다
 */
export function suggestDirs(paths: string[], limit = 20): Array<{ path: string; files: number }> {
  let prefix = "";
  for (;;) {
    const below = paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
    const children = new Map<string, number>();
    let direct = 0;
    for (const rest of below) {
      const i = rest.indexOf("/");
      if (i < 0) direct++;
      else children.set(rest.slice(0, i), (children.get(rest.slice(0, i)) ?? 0) + 1);
    }
    if (children.size === 1 && direct === 0) {
      prefix += `${[...children.keys()][0]}/`;
      continue;
    }
    return [...children]
      .map(([name, files]) => ({ path: `${prefix}${name}`, files }))
      .sort((a, b) => b.files - a.files || a.path.localeCompare(b.path))
      .slice(0, limit);
  }
}

/** 설계 7단계: 한 커밋의 저장소 전체를 지도(패키지 × 역할)와 진입점 투어로 읽게 한다 */
export async function guide(source: FileSource, opts: GuideOptions): Promise<GuideResult> {
  const started = performance.now();
  const [{ paths, generated }, config] = await Promise.all([listGuideFiles(source, opts.dir), opts.config ?? loadConfig(source)]);
  const indexes = await indexSource(source, { paths, onIndexed: (done, total) => opts.onProgress?.({ stage: "read", done, total }) });
  const all = [...indexes.values()];
  const files = all.filter((f) => !f.classes.some((c) => c.annotations.some((a) => a.name === "Generated")));

  opts.onProgress?.({ stage: "link" });
  const graph = buildCallGraph(files);
  const testPaths = new Set(files.filter(isTestFile).map((f) => f.path));
  const isTestMethod = (m: MethodSymbol) => testPaths.has(m.path);
  const isTestId = (id: string) => {
    const m = graph.methods.get(id);
    return m ? isTestMethod(m) : false;
  };
  const detected = detectEntries(graph, isTestMethod, config.entries);

  opts.onProgress?.({ stage: "map" });
  const map = buildMap(files.filter((f) => !testPaths.has(f.path)), graph);
  const nodeOfMethod = (id: string): ClassNode | null => {
    const m = graph.methods.get(id);
    return m ? map.nodeOf(m) : null;
  };

  const entries: TourEntry[] = detected
    .map((e) => ({ id: e.id, kind: e.kind as TourEntryKind, label: e.label, classId: map.nodeOf(e.method)?.id ?? "", symbol: toRef(e.method) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || sortKey(a).localeCompare(sortKey(b)));
  for (const e of entries) map.byId.get(e.classId)?.entryIds.push(e.id);
  for (const node of map.nodes) node.role = roleOf(map.symbols.get(node.id) ?? fileSymbol(node), node.entryIds.length > 0, config.roles);
  const declared = new Set(entries.map((e) => e.id));

  // 간선을 클래스 사이 연결, 많이 쓰이는 정도, 테스트 수로 모은다
  const links = new Map<string, ClassLink>();
  const testers = new Map<string, Set<string>>();
  const crossCallers = new Map<string, number>();
  let edges = 0;
  const addLink = (from: ClassNode, to: ClassNode, confidence: Confidence): void => {
    const key = `${from.id}\u0000${to.id}`;
    const link = links.get(key);
    if (link) {
      link.calls++;
      if (RANK[confidence] > RANK[link.confidence]) link.confidence = confidence;
    } else links.set(key, { from: from.id, to: to.id, calls: 1, confidence });
    if (from.packageName !== to.packageName) to.fanIn += confidence === "low" ? 0.5 : 1;
  };
  const unlinked = findUnlinkedCalls(graph, map, isTestMethod);
  for (const [id, list] of unlinked) {
    const from = nodeOfMethod(id);
    if (!from) continue;
    for (const u of list) addLink(from, map.byId.get(u.classId)!, "medium");
  }
  for (const [id, m] of graph.methods) {
    const from = isTestMethod(m) ? null : map.nodeOf(m);
    for (const e of graph.outgoing(id)) {
      if (isTestId(e.callee)) continue;
      const to = nodeOfMethod(e.callee);
      if (!to) continue;
      if (!from) {
        if (isTestMethod(m)) (testers.get(to.id) ?? testers.set(to.id, new Set()).get(to.id)!).add(id);
        continue;
      }
      edges++;
      if (from.id === to.id) continue;
      addLink(from, to, e.confidence);
      if (from.packageName !== to.packageName) crossCallers.set(e.callee, (crossCallers.get(e.callee) ?? 0) + 1);
    }
  }
  for (const [id, set] of testers) map.byId.get(id)!.tests = set.size;

  const noEntries = entries.length === 0;
  if (noEntries) entries.push(...apiEntries(map, graph, crossCallers));
  // 공개 API 진입점도 칩에서 투어를 시작할 수 있게 붙인다. 역할은 구조를 나타내므로 바꾸지 않는다(유틸 클래스가 진입 열로 가지 않게)
  for (const e of entries) if (!declared.has(e.id)) map.byId.get(e.classId)?.entryIds.push(e.id);

  const guideData: RepoGuide = {
    ref: opts.ref,
    sha: opts.sha,
    dir: opts.dir ?? null,
    stats: {
      files: files.length - testPaths.size,
      generated: generated + all.length - files.length,
      classes: map.nodes.length,
      methods: [...graph.methods.values()].filter((m) => !isTestMethod(m) && !m.synthetic).length,
      edges,
      entries: noEntries ? 0 : entries.length,
      ms: Math.round(performance.now() - started),
    },
    packages: map.packages,
    classes: map.nodes,
    links: [...links.values()],
    entries,
    noEntries,
  };

  const tours = new Map<string, Tour>();
  const tour = (entryId: string): Tour => {
    const hit = tours.get(entryId);
    if (hit) return hit;
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`진입점을 찾을 수 없습니다: ${entryId}`);
    const built = buildTour(graph, entry, isTestId, (id) => nodeOfMethod(id)?.id ?? "", unlinked);
    tours.set(entryId, built);
    return built;
  };
  const entriesThrough = (classId: string): string[] => {
    // 이 클래스와, 이 클래스를 상속하거나 구현하는 클래스(여러 단계)
    const family = new Set([classId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const n of map.nodes) {
        if (!family.has(n.id) && n.supertypeIds.some((s) => family.has(s))) {
          family.add(n.id);
          grew = true;
        }
      }
    }
    return entries
      .filter((e) => tour(e.id).steps.some((s) => family.has(s.classId) || [...s.folded, ...s.external].some((f) => family.has(f.classId))))
      .map((e) => e.id);
  };
  return { guide: guideData, tour, entriesThrough };
}

interface MapIndex {
  nodes: ClassNode[];
  byId: Map<string, ClassNode>;
  /** 클래스 노드의 원래 기호. Kotlin 최상위 함수 파일 노드는 없다 */
  symbols: Map<string, ClassSymbol>;
  packages: PackageNode[];
  nodeOf(m: MethodSymbol): ClassNode | null;
}

/** 지도의 칩. 중첩 클래스와 companion object는 바깥 최상위 클래스에 합친다 */
function buildMap(files: FileIndex[], graph: CallGraph): MapIndex {
  const nodes: ClassNode[] = [];
  const byId = new Map<string, ClassNode>();
  const symbols = new Map<string, ClassSymbol>();
  // 파일 경로와 클래스 qualifiedName → 칩
  const owner = new Map<string, ClassNode>();
  const filesByPackage = new Map<string, number>();

  for (const f of files) {
    filesByPackage.set(f.packageName, (filesByPackage.get(f.packageName) ?? 0) + 1);
    const prefix = f.packageName ? `${f.packageName}.` : "";
    const tops: Array<{ node: ClassNode; qualifiedName: string }> = [];
    for (const c of f.classes) {
      if (c.qualifiedName !== `${prefix}${c.name}`) continue;
      const id = byId.has(c.qualifiedName) ? `${c.qualifiedName}@${f.path}` : c.qualifiedName;
      const node: ClassNode = {
        id, name: c.name, packageName: f.packageName, path: f.path, kind: c.kind, role: "other", range: c.range,
        methods: 0, fanIn: 0, tests: 0, entryIds: [], supertypeIds: [],
      };
      nodes.push(node);
      byId.set(id, node);
      symbols.set(id, c);
      tops.push({ node, qualifiedName: c.qualifiedName });
    }
    for (const c of f.classes) {
      const top = tops.find((x) => c.qualifiedName === x.qualifiedName || c.qualifiedName.startsWith(`${x.qualifiedName}.`));
      if (top) owner.set(`${f.path}#${c.qualifiedName}`, top.node);
    }
    const topLevel = f.methods.filter((m) => m.classQualifiedName === null && !m.synthetic);
    if (topLevel.length) {
      const id = `file:${f.path}`;
      const node: ClassNode = {
        id, name: f.path.split("/").pop()!, packageName: f.packageName, path: f.path, kind: "file", role: "other",
        range: { startLine: Math.min(...topLevel.map((m) => m.range.startLine)), endLine: Math.max(...topLevel.map((m) => m.range.endLine)) },
        methods: 0, fanIn: 0, tests: 0, entryIds: [], supertypeIds: [],
      };
      nodes.push(node);
      byId.set(id, node);
    }
  }

  // 상위 타입은 단순 이름이라 같은 패키지의 것을 먼저, 없으면 같은 이름 전부를 잇는다
  const byName = new Map<string, ClassNode[]>();
  for (const n of nodes) if (n.kind !== "file") (byName.get(n.name) ?? byName.set(n.name, []).get(n.name)!).push(n);
  for (const n of nodes) {
    const sym = symbols.get(n.id);
    if (!sym) continue;
    for (const s of sym.supertypes) {
      const all = (byName.get(s) ?? []).filter((x) => x !== n);
      const same = all.filter((x) => x.packageName === n.packageName);
      n.supertypeIds.push(...(same.length ? same : all).map((x) => x.id));
    }
  }

  const nodeOf = (m: MethodSymbol): ClassNode | null =>
    m.classQualifiedName === null ? byId.get(`file:${m.path}`) ?? null : owner.get(`${m.path}#${m.classQualifiedName}`) ?? null;
  for (const m of graph.methods.values()) {
    if (m.synthetic) continue;
    const node = nodeOf(m);
    if (node) node.methods++;
  }

  // p2가 p10보다 앞에 오게 숫자를 수로 비교한다
  const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const names = [...new Set(nodes.map((n) => n.packageName))].sort(natural);
  const common = commonPrefix(names.filter(Boolean).map((n) => n.split(".")));
  const packages: PackageNode[] = names.map((name) => {
    const parts = name ? name.split(".") : [];
    const rest = parts.slice(common.length).join(".");
    return {
      name,
      label: !name ? "(기본 패키지)" : rest || parts[parts.length - 1]!,
      files: filesByPackage.get(name) ?? 0,
      classIds: nodes.filter((n) => n.packageName === name).sort((a, b) => natural(a.name, b.name)).map((n) => n.id),
    };
  });
  return { nodes, byId, symbols, packages, nodeOf };
}

/** HTTP는 같은 경로의 GET, POST가 붙어 나오게 경로 다음에 메서드로 정렬한다 */
function sortKey(e: TourEntry): string {
  if (e.kind !== "http") return e.label;
  const [verb, path] = e.label.split(" ");
  return `${path ?? ""} ${verb}`;
}

interface Unlinked {
  callIndex: number;
  line: number;
  classId: string;
  name: string;
  /** ctor: 선언 없는 생성자(record, data class, 기본 생성자), member: 물려받았거나 자동으로 생긴 메서드 */
  kind: "ctor" | "member";
}

/**
 * 호출 그래프가 잇지 못한 호출 중 받는 쪽이 저장소 안 타입인 것. 예: OrderRepository의 save(JpaRepository에서 물려받음),
 * record의 접근자, 선언 없는 생성자로 만드는 new OrderResult(...)와 Kotlin OrderPaid(...)
 */
function findUnlinkedCalls(graph: CallGraph, map: MapIndex, isTest: (m: MethodSymbol) => boolean): Map<string, Unlinked[]> {
  const byName = new Map<string, ClassNode[]>();
  for (const n of map.nodes) if (n.kind !== "file") (byName.get(n.name) ?? byName.set(n.name, []).get(n.name)!).push(n);
  const out = new Map<string, Unlinked[]>();
  for (const [id, m] of graph.methods) {
    if (m.synthetic || isTest(m)) continue;
    const self = map.nodeOf(m);
    const linked = new Set(graph.outgoing(id).map((e) => e.callIndex));
    const fields = m.classQualifiedName ? graph.classes.get(m.classQualifiedName)?.fields ?? {} : {};
    m.calls.forEach((call, callIndex) => {
      if (linked.has(callIndex)) return;
      let type: string | null = null;
      let kind: Unlinked["kind"] = "member";
      if (call.name.startsWith("new ")) {
        type = call.name.slice(4);
        kind = "ctor";
      } else if (call.receiver === null && m.language === "kotlin" && /^[A-Z]/.test(call.name)) {
        type = call.name;
        kind = "ctor";
      } else if (call.receiver && !["?", "this", "super"].includes(call.receiver)) {
        const r = call.receiver;
        type = m.locals[r] ?? m.params.find((p) => p.name === r)?.type ?? fields[r] ?? (/^[A-Z]/.test(r) ? r : null);
      }
      if (!type) return;
      const all = byName.get(type) ?? [];
      const same = all.filter((n) => n.packageName === self?.packageName);
      const target = (same.length ? same : all).length === 1 ? (same.length ? same : all)[0]! : null;
      if (!target || target === self) return;
      const name = kind === "ctor" ? `${target.name} 생성자` : `${target.name}.${call.name}`;
      (out.get(id) ?? out.set(id, []).get(id)!).push({ callIndex, line: call.line, classId: target.id, name, kind });
    });
  }
  return out;
}

function commonPrefix(lists: string[][]): string[] {
  if (!lists.length) return [];
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const seg = lists[0]![i];
    if (seg === undefined || lists.some((l) => l[i] !== seg)) return out;
    out.push(seg);
  }
}

function fileSymbol(node: ClassNode): Pick<ClassSymbol, "name" | "kind" | "annotations" | "supertypes"> {
  return { name: node.name.replace(/\.\w+$/, ""), kind: "class", annotations: [], supertypes: [] };
}

/**
 * D19: 다른 패키지에서 많이 부르는 클래스 상위 20개에서, 다른 패키지가 많이 부르는 공개 메서드를 진입점처럼 쓴다.
 * 투어가 한 단계로 끝나는 사소한 메서드와 생성자는 빼고, 오버로드는 가장 많이 불린 하나만 둔다.
 */
function apiEntries(map: MapIndex, graph: CallGraph, crossCallers: Map<string, number>): TourEntry[] {
  const out: TourEntry[] = [];
  const methodsOf = new Map<ClassNode, Array<[string, MethodSymbol]>>();
  for (const [id, m] of graph.methods) {
    if ((crossCallers.get(id) ?? 0) === 0 || m.visibility !== "public" || m.statements <= 1 || isConstructor(m)) continue;
    const node = map.nodeOf(m);
    if (node) (methodsOf.get(node) ?? methodsOf.set(node, []).get(node)!).push([id, m]);
  }
  const top = map.nodes
    .filter((n) => methodsOf.has(n))
    .sort((a, b) => b.fanIn - a.fanIn || a.id.localeCompare(b.id))
    .slice(0, MAX_API_CLASSES);
  for (const node of top) {
    const seen = new Set<string>();
    const methods = methodsOf.get(node)!
      .sort(([a, ma], [b, mb]) => crossCallers.get(b)! - crossCallers.get(a)! || ma.range.startLine - mb.range.startLine)
      .filter(([, m]) => !seen.has(m.name) && seen.add(m.name))
      .slice(0, API_METHODS_PER_CLASS);
    for (const [id, m] of methods) out.push({ id, kind: "api", label: displayName(toRef(m)), classId: node.id, symbol: toRef(m) });
  }
  // 저장소에 같은 표시 이름(클래스.메서드)을 가진 메서드가 더 있으면 구별한다.
  // 다른 클래스면 바깥 클래스 이름을, 그래도 같으면 패키지 마지막 마디를, 같은 클래스의 오버로드면 매개변수 타입을 붙인다
  const sameLabel = new Map<string, MethodSymbol[]>();
  for (const m of graph.methods.values()) {
    if (m.synthetic) continue;
    const l = displayName(toRef(m));
    (sameLabel.get(l) ?? sameLabel.set(l, []).get(l)!).push(m);
  }
  for (const e of out) {
    const m = graph.methods.get(e.id)!;
    const others = (sameLabel.get(e.label) ?? []).filter((x) => x !== m);
    if (others.some((x) => x.classQualifiedName !== m.classQualifiedName)) {
      const chain = e.symbol.container ?? "";
      const clash = others.some((x) => x.container === chain);
      const pkg = map.byId.get(e.classId)?.packageName.split(".").pop();
      e.label = clash && pkg ? `${pkg}.${chain}.${e.symbol.name}` : `${chain}.${e.symbol.name}`;
    }
    if (others.some((x) => x.classQualifiedName === m.classQualifiedName)) e.label += `(${m.params.map((p) => p.display).join(", ")})`;
  }
  return out;
}

function minConfidence(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

function isConstructor(m: MethodSymbol): boolean {
  return m.name === "constructor" || m.name === "init" || m.name === m.container?.split(".").pop();
}

/**
 * 설계 7단계 5.2 투어 순서(D18). 진입점에서 호출문 순서대로 깊이 우선으로 저장소 안 메서드를 잇는다.
 * 본문이 한 문장 이하인 메서드(getter, setter, 한 줄 위임)와 저장소 안 호출이 없는 생성자는 단계로 세지 않고 접는다.
 * 접은 메서드가 다른 메서드를 부르면 그 호출은 접은 메서드를 부른 단계의 같은 줄에서 이어진다.
 * 본문이 없는 추상 메서드는 구현이 없을 때 데이터 접근이나 외부 경계를 보여 주므로 단계로 둔다.
 */
function buildTour(
  graph: CallGraph, entry: TourEntry, isTestId: (id: string) => boolean, classOf: (id: string) => string, unlinked: Map<string, Unlinked[]>,
): Tour {
  const steps: TourStep[] = [];
  const stepOf = new Map<string, number>();
  const collapsed = new Set<string>();
  let truncated = false;

  const outgoing = (id: string) => graph.outgoing(id).filter((e) => !isTestId(e.callee));
  const trivial = (id: string): boolean => {
    const m = graph.methods.get(id)!;
    if (!m.body) return false;
    if (m.statements <= 1) return true;
    return isConstructor(m) && outgoing(id).length === 0;
  };

  /** 한 호출이 여러 메서드로 이어질 때 그 종류 */
  const branchOf = (callees: string[]): TourStep["branch"] => {
    if (callees.length < 2) return null;
    const owners = [...new Set(callees.map((id) => graph.methods.get(id)!.classQualifiedName))];
    if (owners.length === 1) return "overloads";
    const supers = owners.map((qn) => new Set(qn ? graph.classes.get(qn)?.supertypes ?? [] : []));
    const shared = [...supers[0]!].some((s) => supers.every((set) => set.has(s)));
    return shared ? "implementations" : "candidates";
  };

  const addStep = (id: string, parent: TourStep | null, line: number | null, group: string[], confidence: Confidence, depth: number): void => {
    const m = graph.methods.get(id)!;
    const step: TourStep = {
      n: steps.length + 1, symbol: toRef(m), classId: classOf(id), depth, parent: parent?.n ?? null, line,
      alternatives: Math.max(1, group.length), branch: branchOf(group), params: m.params.map((p) => p.display), abstract: m.body === null,
      confidence, calls: [], folded: [], external: [],
    };
    steps.push(step);
    stepOf.set(id, step.n);
    expand(id, step, confidence, null, new Set([id]));
  };

  const pickOverload = <T>(caller: MethodSymbol, ids: string[], back: (id: string) => T): T => {
    const known = new Set([...caller.params.map((p) => p.type), ...Object.values(caller.locals)]);
    const score = (id: string) => graph.methods.get(id)!.params.filter((p) => known.has(p.type)).length;
    const best = [...ids].sort((a, b) => score(b) - score(a) || graph.methods.get(a)!.range.startLine - graph.methods.get(b)!.range.startLine)[0]!;
    return back(best);
  };

  const fold = (list: TourFold[], item: TourFold): void => {
    if (!list.some((f) => f.line === item.line && f.name === item.name && f.params.join() === item.params.join())) list.push(item);
  };

  // id의 호출을 step에 붙인다. via는 접은 메서드를 지나는 중일 때 step 본문의 호출 줄이다
  const expand = (id: string, step: TourStep, confidence: Confidence, via: number | null, chain: Set<string>): void => {
    const m = graph.methods.get(id)!;
    const edges = outgoing(id);
    const groups = new Map<number, typeof edges>();
    for (const e of edges) (groups.get(e.callIndex) ?? groups.set(e.callIndex, []).get(e.callIndex)!).push(e);
    const missing = new Map((unlinked.get(id) ?? []).map((u) => [u.callIndex, u]));
    // 이은 호출과 선언 없는 호출을 본문의 호출 순서대로 처리한다
    for (const index of [...new Set([...groups.keys(), ...missing.keys()])].sort((a, b) => a - b)) {
      const u = missing.get(index);
      if (u) {
        fold(u.kind === "ctor" ? step.folded : step.external, { line: via ?? u.line, name: u.name, params: [], classId: u.classId });
        continue;
      }
      const all = groups.get(index)!;
      const line = via ?? m.calls[index]?.line ?? m.range.startLine;
      // 한 클래스의 같은 이름 메서드(오버로드) 후보는 인자 타입을 몰라 정확히 고를 수 없으므로 하나만 따라간다.
      // 이미 나온 것, 아니면 부르는 메서드의 매개변수와 지역 변수 타입과 가장 많이 겹치는 것(같으면 먼저 선언된 것)
      const overloads = branchOf(all.map((e) => e.callee)) === "overloads";
      const group = overloads ? [all.find((e) => stepOf.has(e.callee)) ?? pickOverload(m, all.map((e) => e.callee), (x) => all.find((e) => e.callee === x)!)] : all;
      for (const e of group) {
        const known = stepOf.get(e.callee);
        if (known !== undefined) {
          step.calls.push({ line, to: known, back: true });
          continue;
        }
        const c = minConfidence(confidence, e.confidence);
        if (trivial(e.callee)) {
          collapsed.add(e.callee);
          const callee = graph.methods.get(e.callee)!;
          fold(step.folded, { line, name: displayName(toRef(callee)), params: callee.params.map((p) => p.display), classId: classOf(e.callee) });
          if (!chain.has(e.callee)) expand(e.callee, step, c, line, new Set([...chain, e.callee]));
          continue;
        }
        if (step.depth + 1 > MAX_TOUR_DEPTH || steps.length >= MAX_TOUR_STEPS) {
          truncated = true;
          continue;
        }
        step.calls.push({ line, to: steps.length + 1, back: false });
        addStep(e.callee, step, line, all.map((x) => x.callee), c, step.depth + 1);
      }
    }
  };

  addStep(entry.id, null, null, [], "high", 0);
  return { entry, steps, collapsed: collapsed.size, truncated };
}
