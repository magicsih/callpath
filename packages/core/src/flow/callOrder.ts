import type { CallOrderDiff, CallSite } from "../types.js";

/**
 * 설계 5.5 호출 순서 비교.
 * 키는 호출 이름이다. 인자 수가 바뀐 호출(시그니처 변경)도 같은 호출로 보고 순서를 비교해야 쿠폰 예시의
 * approve(amount) → approve(discounted, code) 같은 변경에서 이동을 놓치지 않는다. 인자 수 변경은 arityChanged로 따로 기록한다.
 * LCS 해가 여러 개면 이동으로 잡히는 호출의 위치 이동 거리 합이 큰 해를 고른다.
 */
export function diffCallOrder(base: CallSite[], head: CallSite[]): CallOrderDiff {
  const n = base.length;
  const m = head.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = base[i]!.name === head[j]!.name ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const candidates = [backtrack(base, head, dp, "base"), backtrack(base, head, dp, "head")];
  const scored = candidates.map((pairs) => ({ pairs, result: classify(base, head, pairs) }));
  scored.sort((a, b) => displacement(b.result) - displacement(a.result));
  return scored[0]!.result;
}

type Pairs = Array<[number, number]>;

function backtrack(base: CallSite[], head: CallSite[], dp: number[][], prefer: "base" | "head"): Pairs {
  const pairs: Pairs = [];
  let i = 0;
  let j = 0;
  while (i < base.length && j < head.length) {
    if (base[i]!.name === head[j]!.name && dp[i]![j] === dp[i + 1]![j + 1]! + 1) {
      // 건너뛰어도 LCS 길이가 같으면 다른 해가 있다. prefer 쪽을 건너뛰어 다른 해를 만든다.
      if (prefer === "base" && dp[i + 1]![j] === dp[i]![j]) { i++; continue; }
      if (prefer === "head" && dp[i]![j + 1] === dp[i]![j]) { j++; continue; }
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function classify(base: CallSite[], head: CallSite[], pairs: Pairs): CallOrderDiff {
  const matchedBase = new Set(pairs.map((p) => p[0]));
  const matchedHead = new Set(pairs.map((p) => p[1]));
  const baseNames = new Set(base.map((c) => c.name));
  const moved: number[] = [];
  const added: number[] = [];
  const removed: number[] = [];
  const movedAcrossBlock: number[] = [];
  const arityChanged: number[] = [];
  const usedBase = new Set<number>(matchedBase);
  head.forEach((c, idx) => {
    if (matchedHead.has(idx)) {
      const bi = pairs.find((p) => p[1] === idx)![0];
      if (base[bi]!.arity !== c.arity) arityChanged.push(idx);
      return;
    }
    if (!baseNames.has(c.name)) { added.push(idx); return; }
    const partnerIdx = base.findIndex((b, bi) => !usedBase.has(bi) && b.name === c.name);
    if (partnerIdx < 0) { added.push(idx); return; }
    usedBase.add(partnerIdx);
    moved.push(idx);
    const partner = base[partnerIdx]!;
    if (partner.depth !== c.depth || partner.control !== c.control) movedAcrossBlock.push(idx);
    if (partner.arity !== c.arity) arityChanged.push(idx);
  });
  base.forEach((c, idx) => {
    if (!usedBase.has(idx)) removed.push(idx);
  });
  return { base, head, moved, added, removed, movedAcrossBlock, arityChanged };
}

function displacement(d: CallOrderDiff): number {
  let sum = 0;
  const usedBase = new Set<number>();
  for (const hi of d.moved) {
    const c = d.head[hi]!;
    const bi = d.base.findIndex((b, x) => !usedBase.has(x) && b.name === c.name);
    if (bi >= 0) { usedBase.add(bi); sum += Math.abs(bi - hi); }
  }
  return sum;
}
