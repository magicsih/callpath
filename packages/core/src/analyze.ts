import type { FileSource } from "./source/fileSource.js";
import { collectChanges, type ChangedFile } from "./diff/fileChanges.js";
import { parse } from "./index/parser.js";
import { extractMethods, type MethodSymbol } from "./index/symbols.js";
import { diffCallOrder } from "./flow/callOrder.js";
import type { ChangeKind, FileChange, Hunk, Range, ReviewSession, Step } from "./types.js";

export interface AnalyzeOptions {
  repo: string;
  baseLabel: string;
  headLabel: string;
}

/** 1단계 파이프라인: 변경 파일 → 메서드 매핑 → 호출 순서 비교. 흐름 정렬은 2단계에서 더한다. */
export async function analyze(base: FileSource, head: FileSource, opts: AnalyzeOptions): Promise<ReviewSession> {
  const changes = await collectChanges(base, head);
  const orphans: Step[] = [];
  const outsideMethods: FileChange[] = [];
  const otherTests: FileChange[] = [];
  const nonCode: FileChange[] = [];

  for (const change of changes) {
    const fc = toFileChange(change);
    if (change.language === null) { nonCode.push(fc); continue; }
    if (change.isTest) { otherTests.push(fc); continue; }
    const { steps, leftover } = await mapMethods(change);
    orphans.push(...steps);
    if (leftover.length) outsideMethods.push({ ...fc, hunks: leftover });
  }
  orphans.forEach((s, i) => (s.n = i + 1));

  return {
    repo: opts.repo,
    base: opts.baseLabel,
    head: opts.headLabel,
    analysis: { fast: "done", precise: "pending" },
    flows: [],
    orphans,
    outsideMethods,
    otherTests,
    nonCode,
  };
}

function toFileChange(c: ChangedFile): FileChange {
  const { baseText: _b, headText: _h, ...rest } = c;
  return rest;
}

export async function mapMethods(change: ChangedFile): Promise<{ steps: Step[]; leftover: Hunk[] }> {
  const lang = change.language!;
  const baseMethods = change.baseText === null ? [] : extractMethods(change.path, lang, await parse(lang, change.baseText));
  const headMethods = change.headText === null ? [] : extractMethods(change.path, lang, await parse(lang, change.headText));

  const touchedHead = new Map<MethodSymbol, Hunk[]>();
  const touchedBase = new Map<MethodSymbol, Hunk[]>();
  const leftover: Hunk[] = [];
  for (const hunk of change.hunks) {
    let claimed = false;
    if (hunk.head) for (const m of headMethods) if (overlaps(m.range, hunk.head)) { push(touchedHead, m, hunk); claimed = true; }
    if (hunk.base) for (const m of baseMethods) if (overlaps(m.range, hunk.base)) { push(touchedBase, m, hunk); claimed = true; }
    if (!claimed) leftover.push(hunk);
  }

  const pairedBase = new Set<MethodSymbol>();
  const steps: Step[] = [];
  for (const [m, hunks] of touchedHead) {
    const partner = pairSymbol(m, baseMethods, pairedBase);
    if (partner) pairedBase.add(partner);
    const change = classifyChange(m, partner);
    const step: Step = {
      n: 0,
      symbol: m,
      baseSymbol: partner,
      change,
      hunks: dedupe([...hunks, ...(partner ? touchedBase.get(partner) ?? [] : [])]),
      path: [],
      confidence: "medium",
      tests: [],
    };
    if (partner && change !== "signature") {
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

function pairSymbol(m: MethodSymbol, candidates: MethodSymbol[], used: Set<MethodSymbol>): MethodSymbol | null {
  const free = candidates.filter((c) => !used.has(c));
  const same = free.filter((c) => c.qualifiedName === m.qualifiedName);
  if (same.length === 1) return same[0]!;
  if (same.length > 1) return same.find((c) => c.arity === m.arity) ?? same[0]!;
  // 이름 변경 짝짓기: 같은 컨테이너에서 본문 지문이 같거나 충분히 비슷한 것
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

function dedupe(hunks: Hunk[]): Hunk[] {
  const seen = new Set<string>();
  return hunks.filter((h) => {
    const k = JSON.stringify(h);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
