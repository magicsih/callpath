import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { analyze } from "../src/analyze.js";
import { collectChanges } from "../src/diff/fileChanges.js";
import { DirectorySource } from "../src/source/fileSource.js";
import type { ReviewSession } from "../src/types.js";

const FIX = resolve(__dirname, "../../../fixtures");

async function run(lang: "java" | "kotlin"): Promise<ReviewSession> {
  const base = new DirectorySource(resolve(FIX, lang, "base"));
  const head = new DirectorySource(resolve(FIX, lang, "head"));
  return analyze(base, head, { repo: resolve(FIX, lang), baseLabel: "base", headLabel: "head" });
}

/** flows와 orphans를 모두 훑어 이름으로 단계를 찾는다 */
function stepsNamed(session: ReviewSession, name: string) {
  return [...session.flows.flatMap((f) => f.steps), ...session.orphans].filter((s) => s.symbol.name === name);
}

describe.each(["java", "kotlin"] as const)("쿠폰 표본 (%s)", (lang) => {
  it("A1: placeOrder 단계에 호출 순서 이동이 잡힌다", async () => {
    const [step] = stepsNamed(await run(lang), "placeOrder");
    expect(step?.change).toBe("body");
    const d = step!.callOrderDiff!;
    expect(d.moved.map((i) => d.head[i]!.name)).toEqual(["approve"]);
    expect(d.added.map((i) => d.head[i]!.name)).toContain("validateCoupon");
    expect(d.arityChanged.map((i) => d.head[i]!.name)).toContain("approve");
  });

  it("A3: POST /orders 흐름이 진입점부터 호출 순서대로 5단계로 나온다", async () => {
    const session = await run(lang);
    expect(session.flows.map((f) => f.label)).toEqual(["POST /orders"]);
    const flow = session.flows[0]!;
    expect(flow.kind).toBe("http");
    expect(flow.steps.map((s) => `${s.symbol.container}.${s.symbol.name}`)).toEqual([
      "OrderController.place",
      "OrderService.placeOrder",
      "CouponCalculator.validateCoupon",
      "CouponCalculator.discountFor",
      "PaymentClient.approve",
    ]);
    expect(flow.steps.map((s) => s.change)).toEqual(["unchanged", "body", "added", "added", "body"]);
    expect(flow.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    // 호출 스택: discountFor는 place → placeOrder → validateCoupon을 거쳐 닿는다
    expect(flow.steps[3]!.path.map((p) => p.name)).toEqual(["place", "placeOrder", "validateCoupon", "discountFor"]);
    expect(flow.truncated).toBe(false);
  });

  it("A4: 변경 집합과 무관한 OrderCleanupJob은 진입점이지만 흐름을 만들지 않는다", async () => {
    const session = await run(lang);
    expect(session.stats.entries).toBe(2);
    const paths = [
      ...session.flows.flatMap((f) => f.steps.map((s) => s.symbol.path)),
      ...session.orphans.map((s) => s.symbol.path),
      ...session.outsideMethods.map((f) => f.path),
    ];
    expect(paths.some((p) => p.includes("OrderCleanupJob"))).toBe(false);
  });

  it("A5 일부: 테스트는 흐름 단계가 되지 않고 placeOrder를 호출하는 두 테스트가 그 단계에 붙는다", async () => {
    const session = await run(lang);
    const all = [...session.flows.flatMap((f) => f.steps), ...session.orphans];
    expect(all.every((s) => !s.symbol.path.includes("/test/"))).toBe(true);
    const [step] = stepsNamed(session, "placeOrder");
    expect(step!.tests).toHaveLength(2);
    expect(step!.tests.every((t) => t.change !== null && t.hunks.length > 0)).toBe(true);
    // 새로 생긴 쿠폰 테스트는 added, 기존 테스트는 body이고 base 짝이 있다
    const coupon = step!.tests.find((t) => /coupon/i.test(t.symbol.name))!;
    expect(coupon.change).toBe("added");
    expect(coupon.baseSymbol).toBeNull();
    const total = step!.tests.find((t) => /total/i.test(t.symbol.name))!;
    expect(total.change).toBe("body");
    expect(total.baseSymbol?.name).toBe(total.symbol.name);
    expect(step!.tests.map((t) => t.symbol.name).join(" ")).toMatch(/coupon/i);
  });

  it("새 메서드는 added, 시그니처와 본문 주석이 함께 바뀐 approve는 body", async () => {
    const session = await run(lang);
    expect(stepsNamed(session, "validateCoupon")[0]!.change).toBe("added");
    expect(stepsNamed(session, "approve")[0]!.change).toBe("body");
    expect(stepsNamed(session, "approve")[0]!.signatureChanged).toBe(true);
    expect(stepsNamed(session, "placeOrder")[0]!.signatureChanged).toBe(false);
  });

  it("A2: 모든 변경 hunk가 흐름, 미확정, 메서드 밖, 테스트, 비코드 중 한 곳 이상에 나타난다", async () => {
    const session = await run(lang);
    const changes = await collectChanges(new DirectorySource(resolve(FIX, lang, "base")), new DirectorySource(resolve(FIX, lang, "head")));
    const seen = new Set<string>();
    for (const s of [...session.flows.flatMap((f) => f.steps), ...session.orphans]) {
      for (const h of s.hunks) seen.add(JSON.stringify(h));
      for (const t of s.tests) for (const h of t.hunks) seen.add(JSON.stringify(h));
    }
    for (const f of [...session.outsideMethods, ...session.otherTests, ...session.nonCode]) for (const h of f.hunks) seen.add(JSON.stringify(h));
    for (const c of changes) for (const h of c.hunks) expect(seen.has(JSON.stringify(h)), `${h.path} hunk 누락`).toBe(true);
  });
});

describe("깊이 상한", () => {
  it("바뀌지 않은 메서드가 12개 넘게 이어진 뒤의 변경은 흐름에 닿지 못하고 미확정으로 남는다", async () => {
    const { analyzeTrees } = await import("./helpers.js");
    const chain = (last: string) => {
      const methods = Array.from({ length: 14 }, (_, i) => `    void m${i}() { ${i < 13 ? `m${i + 1}();` : last} }`).join("\n");
      return `package p;\n\n@RestController\npublic class Api {\n    @GetMapping("/a")\n    public void a() { m0(); }\n${methods}\n}\n`;
    };
    const session = await analyzeTrees({ "src/main/java/p/Api.java": chain("x();") }, { "src/main/java/p/Api.java": chain("y();") });
    expect(session.flows).toHaveLength(0);
    expect(session.orphans.map((s) => s.symbol.name)).toEqual(["m13"]);
  });
});
