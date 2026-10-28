import { expect, test } from "@playwright/test";
import { launch, makeFixtureRepo, makeTransitRepo, makeUserData, openAndAnalyze, shot } from "./harness";

const java = makeFixtureRepo("java");
const kotlin = makeFixtureRepo("kotlin");

test("표시: 시그니처 변경, 새 테스트, 안내 띠, 메서드 밖 강조, 칩 양쪽 강조", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, java);
  const rows = page.getByTestId("step-row");

  // 매개변수가 바뀐 approve는 본문 변경이면서 시그니처도 바뀜 표시가 붙는다
  await rows.filter({ hasText: "approve" }).click();
  await expect(rows.filter({ hasText: "approve" })).toContainText("시그니처도 바뀜");

  // 추가된 메서드의 안내는 코드 위 띠라서 코드를 덮지 않는다
  await rows.filter({ hasText: "validateCoupon" }).click();
  await expect(page.getByTestId("view-note")).toHaveText("새로 추가된 코드입니다.");
  const note = (await page.getByTestId("view-note").boundingBox())!;
  const diff = (await page.locator(".diff-wrap").boundingBox())!;
  expect(note.y + note.height).toBeLessThanOrEqual(diff.y + 1);

  // 칩을 누르면 이전과 이후의 그 줄을 함께 강조한다
  await rows.filter({ hasText: "placeOrder" }).click();
  await page.getByTestId("call-order").getByRole("button", { name: /^approve, 이동/ }).click();
  // 줄바꿈으로 한 줄이 여러 화면 줄로 나뉠 수 있어 개수 대신 양쪽 편집기에 각각 있는지 본다
  await expect(page.locator(".editor.original .line-highlight").first()).toBeVisible();
  await expect(page.locator(".editor.modified .line-highlight").first()).toBeVisible();

  // 메서드 밖 변경은 그 구간만 강조한다
  await page.getByTestId("file-row").filter({ hasText: "OrderService.java" }).click();
  await expect(page.getByTestId("view-note")).toContainText("메서드 밖에서 바뀐 1곳");
  await expect(page.locator(".line-highlight").first()).toBeVisible();

  // 새로 생긴 테스트는 추가, 기존 테스트는 바뀜. 테스트 항목은 그 메서드 범위만 보인다
  await page.keyboard.press("t");
  const tests = page.getByTestId("test-row");
  await expect(tests.filter({ hasText: "placeOrderAppliesCouponDiscount" })).toContainText("추가");
  await expect(tests.filter({ hasText: "placeOrderPaysTotalAmount" })).toContainText("바뀜");
  await tests.filter({ hasText: "placeOrderAppliesCouponDiscount" }).click();
  await expect(page.locator('[data-view="added"]')).toBeVisible();
  await tests.filter({ hasText: "placeOrderPaysTotalAmount" }).click();
  await expect(page.locator('[data-view="diff"]')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(app, "10-test-slice");
  await app.close();
});

test("좁은 창과 확대에서 문서 자체는 밀리지 않는다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, java);
  await page.keyboard.press("t");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.setContentSize(900, 600);
    w.webContents.setZoomFactor(1.5);
  });
  await page.waitForTimeout(600);
  await page.locator(".toolbar").hover();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const { scrollTop, scrollHeight, innerHeight } = await page.evaluate(() => ({
    scrollTop: document.scrollingElement!.scrollTop,
    scrollHeight: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(scrollTop).toBe(0);
  expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
  await expect(page.getByRole("button", { name: "다시 분석" })).toBeInViewport({ ratio: 1 });
  await app.close();
});

test("저장소별로 비교, 위치, 테스트 표시를 기억한다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, java);
  await page.keyboard.press("t");
  await page.getByTestId("step-row").filter({ hasText: "approve" }).click();

  // 다른 저장소를 연 뒤
  await page.getByRole("button", { name: "비교 바꾸기" }).click();
  await page.getByRole("button", { name: "저장소 바꾸기" }).click();
  await openAndAnalyze(page, kotlin);
  await expect(page.getByRole("checkbox", { name: "테스트 표시" })).not.toBeChecked();

  // 처음 저장소로 돌아오면 비교 기본값과 위치, 테스트 표시가 그 저장소의 것이다
  await page.getByRole("button", { name: "비교 바꾸기" }).click();
  await page.getByRole("button", { name: "저장소 바꾸기" }).click();
  await page.getByRole("button", { name: new RegExp(java.split("/").pop()!) }).click();
  await expect(page.getByLabel("리뷰할 변경 (head)")).toHaveValue("feature/coupon");
  await page.getByRole("button", { name: "흐름 분석" }).click();
  await expect(page.getByTestId("detail-title")).toHaveText("PaymentClient.approve");
  await expect(page.getByRole("checkbox", { name: "테스트 표시" })).toBeChecked();
  await app.close();
});

test("입력 안내: 같은 비교, 목록에 없는 이름, 고친 입력의 지난 오류", async () => {
  const { app, page } = await launch(makeUserData());
  await page.getByLabel("저장소 경로").fill("/");
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  // 입력을 고치기 시작하면 지난 오류는 사라진다
  await page.getByLabel("저장소 경로").fill(java);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("저장소 경로").press("Enter");

  await page.getByLabel("리뷰할 변경 (head)").fill("main");
  await expect(page.getByTestId("compare-warnings")).toContainText("기준과 리뷰할 변경이 같아");
  await page.getByLabel("리뷰할 변경 (head)").fill("feature/nope");
  await expect(page.getByTestId("compare-warnings")).toContainText('브랜치 목록에 없는 리뷰할 변경: "feature/nope"');
  await page.getByLabel("리뷰할 변경 (head)").fill("feature/coupon");
  await expect(page.getByTestId("compare-warnings")).toHaveCount(0);
  await app.close();
});

test("바뀌지 않은 메서드를 건너뛰어 다음 단계로 간다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, makeTransitRepo());
  await expect(page.getByTestId("detail-title")).toHaveText("OrderController.place");
  const next = page.locator(".next-steps");
  await expect(next).toContainText("OrderRepository.confirm");
  await expect(next).toContainText("OrderService.placeOrder 경유");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("detail-title")).toHaveText("OrderRepository.confirm");
  await page.waitForTimeout(300);
  await shot(app, "11-transit-next");
  await app.close();
});

test("끝에 닿아도 초점이 남고 마지막 항목임을 알린다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, java);
  const nextButton = page.getByRole("button", { name: "다음 항목" });
  await nextButton.focus();
  for (let i = 0; i < 10; i++) {
    if (await nextButton.isDisabled()) break;
    await page.keyboard.press("Enter");
  }
  await expect(nextButton).toBeDisabled();
  await expect(page.getByTestId("announce")).toContainText("마지막 항목입니다");
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(focused).toContain("row");
  await app.close();
});

test("Kotlin 기타 테스트는 단계에 붙지 않은 구간만 강조한다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, kotlin);
  await page.keyboard.press("t");
  await page.getByTestId("file-row").filter({ hasText: "OrderServiceTest.kt" }).click();
  await expect(page.getByTestId("view-note")).toContainText("단계에 붙지 않은 테스트 변경 1곳");
  await expect(page.locator(".line-highlight").first()).toBeVisible();
  await app.close();
});
