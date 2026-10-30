import { expect, test, type Page } from "@playwright/test";
import { launch, makeShopRepo, makeUserData, shot } from "./harness";

const repo = makeShopRepo();

async function openGuide(page: Page): Promise<void> {
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByLabel("둘러볼 브랜치나 커밋")).toHaveValue("main");
  await expect(page.getByTestId("guide-start")).toBeVisible();
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
}

const chip = (page: Page, name: string) => page.getByTestId("map-chip").filter({ hasText: new RegExp(`^▶?${name}$`) });

test("B6 B7 B8 둘러보기: 지도에서 클래스를 고르고 투어로 따라간다", async () => {
  const userData = makeUserData();
  // 진행 단계를 볼 수 있게 시작을 조금 늦춘다
  const { app, page } = await launch(userData, { CALLPATH_ANALYZE_DELAY_MS: "600" });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByLabel("둘러볼 브랜치나 커밋")).toHaveValue("main");
  // 브랜치가 하나뿐이면 둘러보기가 주 버튼이고 초점을 받는다
  await expect(page.getByRole("button", { name: "둘러보기", exact: true })).toBeFocused();
  await shot(app, "guide-00-compare");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page.getByTestId("guide-loading")).toBeVisible();
  await shot(app, "guide-01-loading");

  // B6: 진행을 보인 뒤 지도가 나온다
  await expect(page.getByTestId("guide-map")).toBeVisible();
  await expect(page.getByTestId("guide")).toHaveAttribute("data-cached", "false");
  await expect(page.getByTestId("guide-ref")).toContainText("main@");
  await expect(page.locator(".map-grid tbody tr")).toHaveCount(6);
  await expect(page.locator(".map-grid thead th.map-col")).toHaveText(["진입", "서비스", "외부 연동", "데이터", "모델", "설정", "기타"]);
  await shot(app, "guide-02-map");

  // B7: 클래스를 고르면 연결 선과 맥락이 보인다
  await chip(page, "OrderService").click();
  await expect(page.getByTestId("context-title")).toHaveText("OrderService");
  await expect(page.getByTestId("callers")).toContainText("OrderController");
  await expect(page.getByTestId("callees")).toContainText("CouponCalculator");
  const near = (await page.getByTestId("callers").locator("li").count()) + (await page.getByTestId("callees").locator("li").count());
  await expect(page.locator(".map-line")).toHaveCount(near);
  await expect(page.locator(".map-line.low")).toHaveCount(2);
  await expect(page.getByTestId("context-entries")).toContainText("POST /orders");
  await shot(app, "guide-03-selected");

  // 고른 칩을 한 번 더 누르면 코드를 열고, Escape로 지도로 돌아간다
  await chip(page, "OrderService").click();
  await expect(page.getByTestId("code-view")).toBeVisible();
  await expect(page.locator(".view-lines")).toContainText("public OrderResult placeOrder");
  await shot(app, "guide-04-class-code");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("guide-map")).toBeVisible();
  await expect(chip(page, "OrderService")).toBeFocused();

  // 여기서 투어 시작: 이 클래스를 지나는 POST /orders 투어의 OrderService 단계에서 연다
  await page.getByTestId("start-tour").click();
  await expect(page.getByRole("tab", { name: "투어" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("step-title")).toHaveText("OrderService.placeOrder");
  await expect(page.getByTestId("tour-step")).toHaveCount(13);
  await expect(page.locator(".bottombar .position")).toContainText("POST /orders 2 / 13");
  // 코드의 호출 줄 옆에 이어지는 단계 번호가 붙는다. 긴 표시는 줄바꿈으로 여러 조각이 될 수 있어 코드 영역 전체 글자로 본다
  await expect(page.locator(".tour-mark.next").first()).toBeVisible();
  await expect(page.locator(".view-lines")).toContainText("→ 3단계 CouponCalculator.validateCoupon");
  await expect(page.locator(".view-lines")).toContainText("접음 OrderRequest.totalAmount");
  await shot(app, "guide-05-tour");

  // B8: j/k, Enter, Backspace가 리뷰 화면과 같이 움직인다
  await page.keyboard.press("j");
  await expect(page.getByTestId("step-title")).toHaveText("CouponCalculator.validateCoupon");
  await page.keyboard.press("k");
  await expect(page.getByTestId("step-title")).toHaveText("OrderService.placeOrder");
  await page.getByTestId("tour-step").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("step-title")).toHaveText("CouponCalculator.validateCoupon");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("step-title")).toHaveText("CouponRepository.findByCode");
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("step-title")).toHaveText("CouponCalculator.validateCoupon");
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("step-title")).toHaveText("OrderService.placeOrder");
  // 두 구현으로 갈리는 단계와 앞 단계를 다시 부르는 단계
  await page.getByTestId("tour-step").nth(10).click();
  await expect(page.getByTestId("step-title")).toHaveText("PointPaymentClient.approve");
  await expect(page.getByTestId("tour-stack")).toContainText("OrderService.placeOrder");
  await expect(page.locator(".view-lines")).toContainText("↩ 앞 10단계");
  await expect(page.getByTestId("tour-folded")).toContainText("PaymentResult.ok");
  await shot(app, "guide-06-branch");

  // 지도에서 보기: 이 단계의 클래스를 지도에서 고른다
  await page.getByTestId("show-on-map").click();
  await expect(page.getByRole("tab", { name: "지도" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("context-title")).toHaveText("PointPaymentClient");
  await expect(chip(page, "PointPaymentClient")).toHaveAttribute("aria-pressed", "true");
  expect(pageErrors).toEqual([]);
  await app.close();
});

test("B9 다시 열면 마지막 자리로 돌아오고 같은 커밋은 캐시로 그린다", async () => {
  const userData = makeUserData();
  const first = await launch(userData);
  await openGuide(first.page);
  await chip(first.page, "Notifier").click();
  await first.page.getByTestId("start-tour").click();
  await expect(first.page.getByTestId("step-title")).toHaveText("Notifier.sendReceipt");
  await first.app.close();

  const second = await launch(userData);
  await expect(second.page.getByTestId("guide")).toHaveAttribute("data-cached", "true");
  await expect(second.page.getByRole("tab", { name: "투어" })).toHaveAttribute("aria-selected", "true");
  await expect(second.page.getByTestId("step-title")).toHaveText("Notifier.sendReceipt");
  await expect(second.page.getByTestId("entry-row").filter({ hasText: "Kafka order-paid" })).toHaveAttribute("aria-expanded", "true");
  // 지도로 가도 고른 클래스가 남아 있다
  await second.page.getByRole("tab", { name: "지도" }).click();
  await expect(second.page.getByTestId("context-title")).toHaveText("Notifier");
  await second.app.close();
});

test("B10 좁은 창과 확대에서 잘리지 않고, 키보드만으로 지도와 투어를 오간다", async () => {
  const { app, page } = await launch(makeUserData());
  await openGuide(page);
  await expect(page.getByTestId("guide-map")).toBeVisible();
  for (const [w, h, zoom] of [[900, 600, 1], [900, 600, 1.5], [1280, 800, 1.5]] as const) {
    await app.evaluate(({ BrowserWindow }, [w, h, zoom]) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setContentSize(w, h);
      win.webContents.setZoomFactor(zoom);
    }, [w, h, zoom] as const);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const bar = document.querySelector(".toolbar")!;
            return document.documentElement.scrollWidth <= window.innerWidth + 1 && bar.scrollWidth <= bar.clientWidth + 1;
          }),
        { message: `${w}x${h} 확대 ${zoom}` },
      )
      .toBe(true);
    await shot(app, `guide-07-map-${w}x${h}-${zoom}`);
  }

  // 900x600, 150%: 맥락은 지도 아래로 내려온다
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setContentSize(900, 600);
    win.webContents.setZoomFactor(1.5);
  });
  // 키보드만: 탭에서 지도 칩으로, 화살표로 옮기고 Enter로 고른다
  await page.getByRole("tab", { name: "지도" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  let focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  // 패키지 목록 다음에 지도 칩 하나로 들어간다
  while (focused !== "map-chip") {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  }
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator(".narrow-side")).toBeVisible();
  await expect(page.getByTestId("context-title")).not.toBeEmpty();
  await shot(app, "guide-08-narrow-context");
  // 탭 목록에서 오른쪽 화살표로 투어로
  await page.getByRole("tab", { name: "지도" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "투어" })).toBeFocused();
  await expect(page.getByTestId("tour-step").first()).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.locator(".bottombar .position")).toContainText("2 /");
  await shot(app, "guide-09-narrow-tour");
  await page.getByRole("tab", { name: "투어" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("guide-map")).toBeVisible();
  await app.close();
});
