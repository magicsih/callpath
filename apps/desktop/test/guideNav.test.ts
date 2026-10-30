import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DirectorySource, guide } from "@callpath/core";
import { ancestry, childSteps, mapColumns, neighbors, topClasses, tourMarks } from "../src/renderer/src/guideNav";

const shop = () => guide(new DirectorySource(resolve(__dirname, "../../../fixtures/shop")), { ref: "HEAD", sha: "" });

describe("둘러보기 화면 계산", () => {
  it("지도 열은 클래스가 있는 역할만, 많이 쓰이는 클래스는 fan-in 순", async () => {
    const { guide: g } = await shop();
    expect(mapColumns(g)).toEqual(["entry", "service", "integration", "data", "model", "config", "other"]);
    expect(topClasses(g, 3).map((c) => c.name)).toEqual(["Order", "CouponCalculator", "OrderEventPublisher"]);
    const n = neighbors(g, "com.example.shop.order.OrderService");
    expect(n.callers.map((x) => x.node.name)).toEqual(["OrderController"]);
    expect(n.callees.find((x) => x.node.name === "CardPaymentClient")?.low).toBe(true);
  });

  it("투어의 호출 스택, 이어지는 단계, 코드 옆 표시", async () => {
    const r = await shop();
    const t = r.tour(r.guide.entries.find((e) => e.label === "POST /orders")!.id);
    expect(ancestry(t, 4).map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(childSteps(t, 2).map((c) => c.step.n)).toEqual([3, 6, 9, 11, 13]);
    const marks = tourMarks(t, 11);
    expect(marks.some((m) => m.kind === "back" && m.text.includes("↩ 앞 10단계"))).toBe(true);
    expect(marks.some((m) => m.text.includes("→ 12단계 PointLedger.deduct"))).toBe(true);
    expect(marks.some((m) => m.text.includes("접음 PointLedger.balanceOf"))).toBe(true);
    // 줄은 파일 기준 1부터다
    const step11 = t.steps[10]!;
    expect(marks.every((m) => m.line - 1 >= step11.symbol.range.startLine && m.line - 1 <= step11.symbol.range.endLine)).toBe(true);
  });
});
