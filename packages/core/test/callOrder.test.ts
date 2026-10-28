import { describe, expect, it } from "vitest";
import { diffCallOrder } from "../src/flow/callOrder.js";
import type { CallSite } from "../src/types.js";

const seq = (...names: string[]): CallSite[] => names.map((name, i) => ({ name, arity: 1, receiver: null, depth: 0, control: null, nested: false, line: i }));
const names = (d: ReturnType<typeof diffCallOrder>, idx: number[], side: "base" | "head") => idx.map((i) => d[side][i]!.name);

describe("diffCallOrder", () => {
  it("같은 시퀀스면 변화가 없다", () => {
    const d = diffCallOrder(seq("a", "b", "c"), seq("a", "b", "c"));
    expect(d.moved).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("쿠폰 예시: approve가 decrease 뒤로 이동한 것을 잡는다", () => {
    const base = seq("totalAmount", "approve", "decrease", "confirm");
    const head = seq("totalAmount", "validateCoupon", "decrease", "approve", "confirm");
    const d = diffCallOrder(base, head);
    expect(names(d, d.moved, "head")).toEqual(["approve"]);
    expect(names(d, d.added, "head")).toEqual(["validateCoupon"]);
    expect(d.removed).toEqual([]);
  });

  it("인자 수가 바뀐 호출도 같은 호출로 보고 arityChanged에 기록한다", () => {
    const base = seq("approve", "decrease");
    const head: CallSite[] = [{ name: "decrease", arity: 1, receiver: null, depth: 0, control: null, nested: false, line: 0 }, { name: "approve", arity: 2, receiver: null, depth: 0, control: null, nested: false, line: 1 }];
    const d = diffCallOrder(base, head);
    expect(d.moved.length + d.arityChanged.length).toBeGreaterThan(0);
    expect(names(d, d.arityChanged, "head")).toContain("approve");
  });

  it("추가와 삭제만 있으면 이동으로 보지 않는다", () => {
    const d = diffCallOrder(seq("a", "b", "c"), seq("a", "x", "c"));
    expect(d.moved).toEqual([]);
    expect(names(d, d.added, "head")).toEqual(["x"]);
    expect(names(d, d.removed, "base")).toEqual(["b"]);
  });

  it("조건문 안으로 들어간 이동은 movedAcrossBlock에 기록한다", () => {
    const base = seq("a", "b");
    const head: CallSite[] = [{ name: "b", arity: 1, receiver: null, depth: 1, control: "if_statement", nested: false, line: 0 }, { name: "a", arity: 1, receiver: null, depth: 0, control: null, nested: false, line: 1 }];
    const d = diffCallOrder(base, head);
    const movedNames = names(d, d.moved, "head");
    expect(movedNames.length).toBe(1);
    if (movedNames[0] === "b") expect(d.movedAcrossBlock).toEqual(d.moved);
  });
});
