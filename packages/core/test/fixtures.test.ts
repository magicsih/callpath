import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { analyze } from "../src/analyze.js";
import { DirectorySource } from "../src/source/fileSource.js";

const FIX = resolve(__dirname, "../../../fixtures");

async function run(lang: "java" | "kotlin") {
  const base = new DirectorySource(resolve(FIX, lang, "base"));
  const head = new DirectorySource(resolve(FIX, lang, "head"));
  return analyze(base, head, { repo: resolve(FIX, lang), baseLabel: "base", headLabel: "head" });
}

describe.each(["java", "kotlin"] as const)("쿠폰 표본 (%s)", (lang) => {
  it("A1: placeOrder 단계에 호출 순서 이동이 잡힌다", async () => {
    const session = await run(lang);
    const step = session.orphans.find((s) => s.symbol.name === "placeOrder");
    expect(step).toBeDefined();
    expect(step!.change).toBe("body");
    expect(step!.callOrderDiff).toBeDefined();
    const d = step!.callOrderDiff!;
    expect(d.moved.length).toBeGreaterThan(0);
    const movedNames = d.moved.map((i) => d.head[i]!.name);
    expect(movedNames.some((n) => n === "approve" || n === "decrease")).toBe(true);
    expect(d.added.map((i) => d.head[i]!.name)).toContain("validateCoupon");
  });

  it("새 클래스의 메서드는 added, 시그니처와 본문이 바뀐 approve는 body로 분류한다", async () => {
    const session = await run(lang);
    const kinds = Object.fromEntries(session.orphans.map((s) => [s.symbol.qualifiedName, s.change]));
    expect(kinds["shop.order.CouponCalculator.validateCoupon"]).toBe("added");
    expect(kinds["shop.order.PaymentClient.approve"]).toBe("body");
  });

  it("테스트 파일은 orphans에 들어가지 않고 otherTests로 분리된다", async () => {
    const session = await run(lang);
    expect(session.orphans.every((s) => !s.symbol.path.includes("/test/"))).toBe(true);
    expect(session.otherTests.map((f) => f.path)).toEqual([expect.stringMatching(/OrderServiceTest\.(java|kt)$/)]);
  });

  it("변경 집합과 무관한 OrderCleanupJob은 어디에도 나오지 않는다", async () => {
    const session = await run(lang);
    const all = [...session.orphans.map((s) => s.symbol.path), ...session.outsideMethods.map((f) => f.path), ...session.nonCode.map((f) => f.path)];
    expect(all.some((p) => p.includes("OrderCleanupJob"))).toBe(false);
  });

  it("A2: 모든 변경 hunk가 orphans, outsideMethods, otherTests, nonCode 중 한 곳 이상에 나타난다", async () => {
    const session = await run(lang);
    const { collectChanges } = await import("../src/diff/fileChanges.js");
    const changes = await collectChanges(new DirectorySource(resolve(FIX, lang, "base")), new DirectorySource(resolve(FIX, lang, "head")));
    const seen = new Set<string>();
    for (const s of session.orphans) for (const h of s.hunks) seen.add(JSON.stringify(h));
    for (const f of [...session.outsideMethods, ...session.otherTests, ...session.nonCode]) for (const h of f.hunks) seen.add(JSON.stringify(h));
    for (const c of changes) for (const h of c.hunks) expect(seen.has(JSON.stringify(h)), `${h.path} hunk 누락`).toBe(true);
  });
});
