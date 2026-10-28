import { describe, expect, it } from "vitest";
import { findJava, findKotlinLsp, sourceRoots } from "../src/index.js";
import type { FileIndex } from "@callpath/core";

const file = (path: string, packageName: string, language: "java" | "kotlin" = "java"): FileIndex => ({ path, packageName, language, classes: [], methods: [] });

describe("소스 루트 추론", () => {
  it("패키지 선언으로 Maven, Gradle 배치와 다중 모듈의 소스 루트를 찾는다", () => {
    const roots = sourceRoots(
      [
        file("src/main/java/shop/order/A.java", "shop.order"),
        file("src/test/java/shop/order/ATest.java", "shop.order"),
        file("billing/src/main/java/shop/billing/B.java", "shop.billing"),
        file("Tool.java", ""),
        file("src/main/kotlin/shop/K.kt", "shop", "kotlin"),
      ],
      "java",
    );
    expect(roots).toEqual([".", "billing/src/main/java", "src/main/java", "src/test/java"]);
  });

  it("패키지와 폴더가 맞지 않으면 그 폴더를 소스 루트로 둔다", () => {
    expect(sourceRoots([file("src/weird/A.java", "shop.order")], "java")).toEqual(["src/weird"]);
  });
});

describe("도구 찾기", () => {
  it("CALLPATH_JAVA_HOME=none이면 JDK를 찾지 않는다", async () => {
    expect(await findJava({ CALLPATH_JAVA_HOME: "none" })).toEqual({ error: expect.stringContaining("JDK 21 이상") });
  });

  it("CALLPATH_KOTLIN_LSP=none이면 kotlin-lsp를 찾지 않고 설치 안내를 준다", async () => {
    const r = await findKotlinLsp({ CALLPATH_KOTLIN_LSP: "none" });
    expect(r).toEqual({ error: expect.stringContaining("brew install") });
  });

  it("없는 kotlin-lsp 경로는 오류로 알린다", async () => {
    expect(await findKotlinLsp({ CALLPATH_KOTLIN_LSP: "/no/such/kotlin-lsp" })).toEqual({ error: expect.stringContaining("/no/such/kotlin-lsp") });
  });
});
