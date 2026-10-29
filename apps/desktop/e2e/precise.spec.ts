import { expect, test } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, makeFixtureRepo, makeUserData, openAndAnalyze, shot } from "./harness";

// JDT LS는 한 번 내려받아 시나리오끼리 함께 쓴다(CI는 이 폴더를 캐시한다)
const LSP_CACHE = process.env.CALLPATH_LSP_CACHE ?? join(tmpdir(), "callpath-lsp-cache");
const PRECISE_ON = { CALLPATH_PRECISE: "", CALLPATH_LSP_CACHE: LSP_CACHE };

test("정밀 분석을 끄면 상태만 보이고 안내 띠는 없다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, makeFixtureRepo("java"));
  await expect(page.getByTestId("precise-chip")).toHaveText("정밀 분석 꺼짐");
  await expect(page.getByTestId("precise-banner")).toHaveCount(0);
  await app.close();
});

test("A8 JDK가 없으면 안내 띠가 뜨고 리뷰는 그대로 된다", async () => {
  const { app, page } = await launch(makeUserData(), { ...PRECISE_ON, CALLPATH_JAVA_HOME: "none" });
  await openAndAnalyze(page, makeFixtureRepo("java"));
  await expect(page.getByTestId("precise-chip")).toHaveText("정밀 분석 없음", { timeout: 30_000 });
  await expect(page.getByTestId("precise-banner")).toContainText("Java: JDK 21 이상을 찾지 못했습니다");
  await page.keyboard.press("j");
  await expect(page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  await shot(app, "12-precise-no-jdk");
  await page.getByTestId("precise-banner").getByRole("button", { name: "닫기" }).click();
  await expect(page.getByTestId("precise-banner")).toHaveCount(0);
  await app.close();
});

test("kotlin-lsp가 없으면 Kotlin 설치 안내가 뜬다", async () => {
  const { app, page } = await launch(makeUserData(), { ...PRECISE_ON, CALLPATH_KOTLIN_LSP: "none" });
  await openAndAnalyze(page, makeFixtureRepo("kotlin"));
  await expect(page.getByTestId("precise-banner")).toContainText("Kotlin: kotlin-lsp를 찾지 못했습니다", { timeout: 30_000 });
  await expect(page.getByTestId("precise-banner")).toContainText("brew install JetBrains/utils/kotlin-lsp");
  await app.close();
});

test("A8 JDK가 있으면 JDT LS로 정밀 분석하고, 보던 위치를 지키며, 다시 열면 저장한 결과를 쓴다", async () => {
  // Playwright는 테스트 파일을 CommonJS로 읽어 ESM 패키지는 동적 import로 불러온다
  const { findJava } = await import("@callpath/lsp");
  const java = await findJava();
  test.skip("error" in java, "JDK 21 이상이 없어 건너뜀");
  test.setTimeout(300_000);
  const data = makeUserData();
  const repo = makeFixtureRepo("java");
  const first = await launch(data, PRECISE_ON);
  await openAndAnalyze(first.page, repo);
  // 빠른 분석 결과로 먼저 읽기 시작한다
  await first.page.keyboard.press("j");
  await expect(first.page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  // 정밀 분석 결과가 와도 가운데 코드는 다시 읽지 않는다
  await first.page.locator(".diff-wrap .diff").waitFor();
  await first.page.evaluate(() => { (window as unknown as { __diff: Element | null }).__diff = document.querySelector(".diff-wrap .diff"); });
  await expect(first.page.getByTestId("precise-chip")).toHaveText("정밀 분석 완료", { timeout: 240_000 });
  expect(await first.page.evaluate(() => (window as unknown as { __diff: Element | null }).__diff === document.querySelector(".diff-wrap .diff"))).toBe(true);
  // 정밀 분석 결과가 와도 보던 단계와 흐름은 그대로다
  await expect(first.page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  await expect(first.page.getByTestId("position")).toContainText("POST /orders · 2 / 5");
  await expect(first.page.getByTestId("precise-banner")).toHaveCount(0);
  await shot(first.app, "13-precise-done");
  await first.app.close();

  // 같은 비교를 다시 열면 저장한 결과라 LSP를 띄우지 않고 바로 완료로 보인다
  const second = await launch(data, PRECISE_ON);
  await expect(second.page.getByTestId("precise-chip")).toHaveText("정밀 분석 완료", { timeout: 10_000 });
  await second.app.close();
});

test("정밀 분석할 바뀐 메서드가 없으면 상태를 보이지 않는다", async () => {
  const { makeRepoWithHeadEdit } = await import("./harness");
  const repo = makeRepoWithHeadEdit("src/test/java/shop/order/OrderServiceTest.java", (t) => t.replace("assertEquals(2000", "assertEquals(2_000"));
  const { app, page } = await launch(makeUserData(), PRECISE_ON);
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await page.getByRole("button", { name: "흐름 분석" }).click();
  // 테스트만 바뀌었으면 바뀐 것이 없다고 하지 않고 테스트 표시를 안내한다
  await expect(page.getByTestId("state-tests-only")).toContainText("테스트 코드만 바뀌었습니다");
  await page.getByRole("button", { name: "테스트 표시 켜기" }).click();
  await page.getByTestId("file-row").first().waitFor();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("precise-chip")).toHaveCount(0);
  await expect(page.getByTestId("precise-banner")).toHaveCount(0);
  await app.close();
});
