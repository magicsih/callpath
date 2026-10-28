import type { FileSource } from "./source/fileSource.js";
import { collectChanges, languageOf, type ChangedFile } from "./diff/fileChanges.js";
import { parse } from "./index/parser.js";
import { extractMethods, indexFile, type FileIndex, type MethodSymbol } from "./index/symbols.js";
import { diffCallOrder } from "./flow/callOrder.js";
import { buildCallGraph, methodId, type CallGraph } from "./graph/callGraph.js";
import { detectEntries } from "./flow/entries.js";
import { buildFlows, toRef } from "./flow/flows.js";
import { isTestFile, isTestPath } from "./classify/test.js";
import { loadConfig, type CallpathConfig } from "./config.js";
import type { ChangeKind, FileChange, Hunk, Range, ReviewSession, Step, TestRef } from "./types.js";

export interface AnalyzeOptions {
  repo: string;
  baseLabel: string;
  headLabel: string;
  /** 주지 않으면 head 시점의 .callpath.yml을 읽는다 */
  config?: CallpathConfig;
}

const MAX_TESTS_PER_STEP = 20;

/** 설계 5절 빠른 분석: 변경 파일 → 메서드 매핑 → 호출 그래프 → 진입점 → 흐름 정렬 → 테스트 연결 */
export async function analyze(base: FileSource, head: FileSource, opts: AnalyzeOptions): Promise<ReviewSession> {
  const started = performance.now();
  const [changes, config, indexes] = await Promise.all([collectChanges(base, head), opts.config ?? loadConfig(head), indexSource(head)]);
  const graph = buildCallGraph([...indexes.values()]);
  const testPaths = new Set([...indexes.values()].filter(isTestFile).map((f) => f.path));
  const isTestMethod = (m: MethodSymbol) => testPaths.has(m.path);
  const isTestId = (id: string) => {
    const m = graph.methods.get(id);
    return m ? isTestMethod(m) : false;
  };

  const changed = new Map<string, Step>();
  const removed: Step[] = [];
  const outsideMethods: FileChange[] = [];
  const testChanges: ChangedFile[] = [];
  const nonCode: FileChange[] = [];

  for (const change of changes) {
    if (change.language === null) { nonCode.push(toFileChange(change)); continue; }
    const isTest = testPaths.has(change.path) || (change.headText === null && isTestPath(change.path));
    if (isTest) { testChanges.push({ ...change, isTest: true }); continue; }
    const { steps, leftover } = await mapMethods(change, indexes.get(change.path)?.methods);
    for (const s of steps) {
      if (s.change === "removed") removed.push(s);
      else changed.set(methodId(s.symbol), s);
    }
    if (leftover.length) outsideMethods.push({ ...toFileChange(change), hunks: leftover });
  }

  const entries = detectEntries(graph, isTestMethod, config.entries);
  const { flows, claimed } = buildFlows(graph, entries, changed, isTestId);
  const orphans = [...[...changed.entries()].filter(([id]) => !claimed.has(id)).map(([, s]) => s), ...removed]
    .sort((a, b) => a.symbol.path.localeCompare(b.symbol.path) || a.symbol.range.startLine - b.symbol.range.startLine);
  orphans.forEach((s, i) => (s.n = i + 1));

  // 테스트 파일도 메서드에 매핑해 base 쪽에만 있는 삭제 hunk까지 해당 테스트 메서드에 붙인다
  const testHunks = new Map<string, Hunk[]>();
  for (const tc of testChanges) {
    if (tc.language === null || tc.headText === null) continue;
    const { steps } = await mapMethods(tc, indexes.get(tc.path)?.methods);
    for (const s of steps) if (s.change !== "removed") testHunks.set(methodId(s.symbol), s.hunks);
  }
  const attached = attachTests(graph, [...flows.flatMap((f) => f.steps), ...orphans], testHunks, isTestId);
  const otherTests: FileChange[] = [];
  for (const tc of testChanges) {
    const left = tc.hunks.filter((h) => !attached.has(hunkKey(h)));
    if (left.length) otherTests.push({ ...toFileChange(tc), hunks: left });
  }

  return {
    repo: opts.repo,
    base: opts.baseLabel,
    head: opts.headLabel,
    analysis: { fast: "done", precise: "pending" },
    flows: flows.map((f) => ({ ...f, steps: f.steps.map(compactStep) })),
    orphans: orphans.map(compactStep),
    outsideMethods,
    otherTests,
    nonCode,
    stats: {
      files: indexes.size,
      methods: graph.methods.size,
      edges: [...graph.methods.keys()].reduce((n, id) => n + graph.outgoing(id).length, 0),
      entries: entries.length,
      ms: Math.round(performance.now() - started),
    },
  };
}

async function indexSource(source: FileSource): Promise<Map<string, FileIndex>> {
  const paths = (await source.listFiles()).filter((p) => languageOf(p) !== null);
  const texts = await source.readMany(paths);
  const out = new Map<string, FileIndex>();
  for (const path of paths) {
    const lang = languageOf(path)!;
    out.set(path, indexFile(path, lang, await parse(lang, texts.get(path)!)));
  }
  return out;
}

/**
 * 바뀐 메서드마다 그 메서드를 직접 호출하는 테스트를 붙인다. 테스트 hunk 중 붙은 것을 돌려준다.
 * 같은 메서드가 여러 흐름에 참조로 나오면 같은 목록을 공유한다.
 */
function attachTests(graph: CallGraph, steps: Step[], testHunks: Map<string, Hunk[]>, isTestId: (id: string) => boolean): Set<string> {
  const attached = new Set<string>();
  for (const step of steps) {
    if (step.change === "unchanged" || step.change === "removed") continue;
    const id = methodId(step.symbol);
    const refs = new Map<string, TestRef>();
    for (const e of graph.incoming(id)) {
      if (!isTestId(e.caller) || refs.has(e.caller)) continue;
      const t = graph.methods.get(e.caller)!;
      const hunks = testHunks.get(e.caller) ?? [];
      hunks.forEach((h) => attached.add(hunkKey(h)));
      refs.set(e.caller, { symbol: toRef(t), changed: hunks.length > 0, hunks, confidence: e.confidence });
    }
    step.tests = [...refs.values()]
      .sort((a, b) => Number(b.changed) - Number(a.changed) || a.symbol.path.localeCompare(b.symbol.path) || a.symbol.range.startLine - b.symbol.range.startLine)
      .slice(0, MAX_TESTS_PER_STEP);
  }
  return attached;
}

/** 출력 JSON에서 MethodSymbol의 내부 필드(호출 목록, 지문 등)를 덜어낸다 */
function compactStep(s: Step): Step {
  return { ...s, symbol: toRef(s.symbol), baseSymbol: s.baseSymbol ? toRef(s.baseSymbol) : null };
}

function toFileChange(c: ChangedFile): FileChange {
  const { baseText: _b, headText: _h, ...rest } = c;
  return rest;
}

/** 바뀐 파일 하나의 hunk를 메서드에 매핑한다. headMethods를 주면 그 심볼을 그대로 써서 그래프와 같은 식별자를 갖게 한다. */
export async function mapMethods(change: ChangedFile, headMethods?: MethodSymbol[]): Promise<{ steps: Step[]; leftover: Hunk[] }> {
  const lang = change.language!;
  const baseMethods = change.baseText === null ? [] : extractMethods(change.path, lang, await parse(lang, change.baseText));
  const head = headMethods ?? (change.headText === null ? [] : extractMethods(change.path, lang, await parse(lang, change.headText)));

  const touchedHead = new Map<MethodSymbol, Hunk[]>();
  const touchedBase = new Map<MethodSymbol, Hunk[]>();
  const leftover: Hunk[] = [];
  for (const hunk of change.hunks) {
    let claimed = false;
    if (hunk.head) for (const m of head) if (overlaps(m.range, hunk.head)) { push(touchedHead, m, hunk); claimed = true; }
    if (hunk.base) for (const m of baseMethods) if (overlaps(m.range, hunk.base)) { push(touchedBase, m, hunk); claimed = true; }
    if (!claimed) leftover.push(hunk);
  }

  const pairedBase = new Set<MethodSymbol>();
  const steps: Step[] = [];
  for (const [m, hunks] of touchedHead) {
    const partner = pairSymbol(m, baseMethods, pairedBase);
    if (partner) pairedBase.add(partner);
    const kind = classifyChange(m, partner);
    const step: Step = {
      n: 0,
      symbol: m,
      baseSymbol: partner,
      change: kind,
      hunks: dedupe([...hunks, ...(partner ? touchedBase.get(partner) ?? [] : [])]),
      path: [],
      confidence: "medium",
      tests: [],
    };
    if (partner && kind !== "signature") {
      const d = diffCallOrder(partner.calls, m.calls);
      if (d.moved.length || d.added.length || d.removed.length || d.arityChanged.length) step.callOrderDiff = d;
    }
    steps.push(step);
  }
  for (const [m, hunks] of touchedBase) {
    if (pairedBase.has(m)) continue;
    steps.push({ n: 0, symbol: m, baseSymbol: m, change: "removed", hunks, path: [], confidence: "medium", tests: [] });
  }
  steps.sort((a, b) => a.symbol.range.startLine - b.symbol.range.startLine);
  return { steps, leftover };
}

/**
 * head 메서드의 base 짝을 찾는다. 같은 이름이 여러 개(오버로드)면 인자 수 차이가 가장 작은 것,
 * 그다음 본문이 더 비슷한 것을 고른다. 같은 이름이 없으면 같은 클래스에서 본문이 비슷한 것을 이름 변경으로 본다.
 */
function pairSymbol(m: MethodSymbol, candidates: MethodSymbol[], used: Set<MethodSymbol>): MethodSymbol | null {
  const free = candidates.filter((c) => !used.has(c));
  const same = free.filter((c) => c.qualifiedName === m.qualifiedName);
  if (same.length) {
    return same.reduce((best, c) => {
      const d = Math.abs(c.arity - m.arity) - Math.abs(best.arity - m.arity);
      if (d !== 0) return d < 0 ? c : best;
      return similarity(c.bodyFingerprint, m.bodyFingerprint) > similarity(best.bodyFingerprint, m.bodyFingerprint) ? c : best;
    });
  }
  const renamed = free.filter((c) => c.container === m.container && c.bodyFingerprint.length > 20 && similarity(c.bodyFingerprint, m.bodyFingerprint) >= 0.8);
  return renamed[0] ?? null;
}

function classifyChange(m: MethodSymbol, partner: MethodSymbol | null): ChangeKind {
  if (!partner) return "added";
  if (partner.name !== m.name) return "renamed";
  // hunk 위치로 판정하면 여는 중괄호가 시그니처와 같은 줄이라 시그니처 변경이 본문 변경으로 잡힌다. 본문 내용으로 비교한다.
  return partner.bodyFingerprint !== m.bodyFingerprint ? "body" : "signature";
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let common = 0;
  const grams = new Set<string>();
  for (let i = 0; i + 8 <= shorter.length; i += 4) grams.add(shorter.slice(i, i + 8));
  for (const g of grams) if (longer.includes(g)) common++;
  return grams.size ? common / grams.size : 0;
}

function overlaps(a: Range, b: Range): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function push<K>(map: Map<K, Hunk[]>, k: K, h: Hunk): void {
  const list = map.get(k);
  if (list) list.push(h);
  else map.set(k, [h]);
}

function hunkKey(h: Hunk): string {
  return JSON.stringify(h);
}

function dedupe(hunks: Hunk[]): Hunk[] {
  const seen = new Set<string>();
  return hunks.filter((h) => {
    const k = JSON.stringify(h);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
