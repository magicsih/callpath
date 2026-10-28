import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { analyze, DirectorySource } from "@callpath/core";
import { buildNav, childSteps, describeMoves, neighbor, resolveSelection, type StepItem } from "../src/renderer/src/nav";

const FIX = resolve(__dirname, "../../../fixtures/java");
const session = await analyze(new DirectorySource(resolve(FIX, "base")), new DirectorySource(resolve(FIX, "head")), {
  repo: FIX, baseLabel: "base", headLabel: "head",
});

describe("목록과 이동 순서", () => {
  it("흐름, 미확정, 메서드 밖 순서로 묶고 테스트는 기본으로 숨긴다", () => {
    const nav = buildNav(session, false);
    expect(nav.groups.map((g) => g.label)).toEqual(["POST /orders", "진입점 미확정", "메서드 밖 변경"]);
    expect(nav.order.some((i) => i.kind === "test")).toBe(false);
    expect(nav.hiddenTestFiles).toBe(1);
  });

  it("테스트를 켜면 단계 바로 뒤에 그 단계를 부르는 테스트가 온다", () => {
    const nav = buildNav(session, true);
    const i = nav.order.findIndex((x) => x.kind === "step" && x.step.symbol.name === "placeOrder");
    expect(nav.order[i + 1]?.kind).toBe("test");
    expect(nav.order[i + 2]?.kind).toBe("test");
    expect(nav.hiddenTestFiles).toBe(0);
  });

  it("다음과 이전은 순서를 따르고 끝에서는 null", () => {
    const nav = buildNav(session, false);
    const first = nav.order[0]!;
    expect(neighbor(nav, first.key, -1)).toBeNull();
    expect(neighbor(nav, first.key, 1)?.key).toBe(nav.order[1]!.key);
  });

  it("테스트를 끈 뒤 저장해 둔 테스트 항목은 부모 단계로 복원한다", () => {
    const withTests = buildNav(session, true);
    const test = withTests.order.find((x) => x.kind === "test")!;
    const nav = buildNav(session, false);
    const restored = resolveSelection(nav, test.key);
    expect(restored?.kind).toBe("step");
    expect((restored as StepItem).step.symbol.name).toBe("placeOrder");
  });

  it("이어지는 단계와 이동 문장", () => {
    const nav = buildNav(session, false);
    const place = nav.order.find((x) => x.kind === "step" && x.step.symbol.name === "placeOrder") as StepItem;
    expect(childSteps(place, nav).map((s) => s.step.symbol.name)).toEqual(["validateCoupon", "approve"]);
    expect(describeMoves(place.step)).toEqual(["approve 호출이 decrease 다음으로 옮겨졌습니다"]);
  });
});
