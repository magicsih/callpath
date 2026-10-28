import { describe, expect, it } from "vitest";
import { mapMethods } from "../src/analyze.js";
import { hunksBetween } from "../src/diff/fileChanges.js";
import type { Language } from "../src/types.js";

async function kinds(path: string, language: Language, base: string, head: string) {
  const hunks = hunksBetween(path, base, head);
  const { steps } = await mapMethods({ path, status: "modified", language, isTest: false, hunks, baseText: base, headText: head });
  return Object.fromEntries(steps.map((s) => [s.symbol.name, s.change]));
}

describe("변경 종류 분류", () => {
  it("Java: 시그니처만 바뀌면 signature", async () => {
    const base = "class A {\n    void pay(long amount) {\n        gateway(amount);\n    }\n}\n";
    const head = "class A {\n    void pay(long amount, String code) {\n        gateway(amount);\n    }\n}\n";
    expect(await kinds("A.java", "java", base, head)).toEqual({ pay: "signature" });
  });

  it("Kotlin: 시그니처만 바뀌면 signature", async () => {
    const base = "class A {\n    fun pay(amount: Long) {\n        gateway(amount)\n    }\n}\n";
    const head = "class A {\n    fun pay(amount: Long, code: String?) {\n        gateway(amount)\n    }\n}\n";
    expect(await kinds("A.kt", "kotlin", base, head)).toEqual({ pay: "signature" });
  });

  it("본문이 바뀌면 body", async () => {
    const base = "class A {\n    void pay(long amount) {\n        gateway(amount);\n    }\n}\n";
    const head = "class A {\n    void pay(long amount) {\n        gateway(amount * 2);\n    }\n}\n";
    expect(await kinds("A.java", "java", base, head)).toEqual({ pay: "body" });
  });
});

describe("오버로드 짝짓기 (#2)", () => {
  it("인자 수가 바뀐 오버로드는 인자 수가 가장 가까운 base 메서드와 짝짓는다", async () => {
    const base = "class A {\n    void pay(long a) {\n        one(a);\n    }\n\n    void pay(long a, String c) {\n        two(a, c);\n    }\n}\n";
    const head = "class A {\n    void pay(long a) {\n        one(a);\n    }\n\n    void pay(long a, String c, int n) {\n        two(a, c);\n    }\n}\n";
    const hunks = hunksBetween("A.java", base, head);
    const { steps } = await mapMethods({ path: "A.java", status: "modified", language: "java", isTest: false, hunks, baseText: base, headText: head });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.change).toBe("signature");
    expect(steps[0]!.baseSymbol!.arity).toBe(2);
  });
});
