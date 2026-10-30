import { expect, test, type Page } from "@playwright/test";
import { launch, makeLargeRepo, makeShopRepo, makeUserData, shot } from "./harness";

const repo = makeShopRepo();

async function openGuide(page: Page): Promise<void> {
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByLabel("둘러볼 브랜치나 커밋")).toHaveValue("main");
  await expect(page.getByTestId("guide-start")).toBeVisible();
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
}

/** 코드 줄 끝 표시의 글자. 긴 표시는 줄바꿈으로 여러 조각이 되므로 조각만 이어 붙이고, 편집기가 쓰는 줄바꿈 없는 공백을 보통 공백으로 맞춘다 */
const marks = (page: Page) => page.evaluate(() => [...document.querySelectorAll(".tour-mark")].map((e) => e.textContent).join("").replace(/\s+/g, " "));

// 칩 글자에는 화면 읽기용 설명이 붙을 수 있어 클래스 id 끝으로 찾는다
const chip = (page: Page, name: string) => page.locator(`[data-testid="map-chip"][data-class-id$=".${name}"]`);

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

  // 인터페이스를 고르면 구현과, 구현을 부르는 쪽이 보이고 그 진입점 투어를 시작할 수 있다
  await chip(page, "PaymentClient").click();
  await expect(page.getByTestId("implementors")).toContainText("CardPaymentClient");
  // 실제 호출은 구현으로 이어져 있어, 구현을 통해 부르는 쪽을 부르는 쪽에 합쳐 보인다. 구현은 칩 점선 테두리로
  await expect(page.getByTestId("callers")).toContainText("OrderService");
  await expect(page.getByTestId("callers")).toContainText("구현을 통해 부름");
  await expect(page.locator(".map-chip.impl")).toHaveCount(2);
  await expect(page.getByTestId("context-entries")).toContainText("POST /orders");
  await expect(page.getByTestId("start-tour")).toBeEnabled();
  // 접은 getter로만 닿는 클래스도 지나는 진입점이 있다
  await chip(page, "OrderRequest").click();
  await expect(page.getByTestId("context-entries")).toContainText("POST /orders");
  await chip(page, "OrderService").click();

  // 고른 칩을 한 번 더 누르면 코드를 열고, Escape로 지도로 돌아간다
  await chip(page, "OrderService").click();
  await expect(page.getByTestId("code-view")).toBeVisible();
  // 클래스 선언 줄을 보이게 연다(작은 창에서는 메서드 본문이 화면 밖일 수 있다)
  await expect(page.locator(".view-lines")).toContainText("public class OrderService");
  await shot(app, "guide-04-class-code");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("guide-map")).toBeVisible();
  await expect(chip(page, "OrderService")).toBeFocused();

  // 처음 여는 진입점이어도 "여기서 투어 시작"은 그 클래스 단계 줄로 초점을 옮겨, 이어서 Enter를 누르면 다음 단계로 간다
  await chip(page, "StockService").click();
  await page.getByTestId("start-tour").click();
  await expect(page.getByTestId("step-title")).toHaveText("StockService.decrease");
  await expect(page.getByTestId("tour-step").nth(5)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("step-title")).toHaveText("StockRepository.remaining");
  // 오른쪽 호출 스택 링크를 누르면 초점이 새 단계 줄로 간다
  await page.getByTestId("tour-stack").getByRole("button", { name: "OrderService.placeOrder" }).click();
  await expect(page.getByTestId("tour-step").nth(1)).toBeFocused();
  await page.getByRole("tab", { name: "지도" }).click();
  await chip(page, "OrderService").click();

  // 여기서 투어 시작: 이 클래스를 지나는 POST /orders 투어의 OrderService 단계에서 연다
  await page.getByTestId("start-tour").click();
  await expect(page.getByRole("tab", { name: "투어" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("step-title")).toHaveText("OrderService.placeOrder");
  await expect(page.getByTestId("tour-step")).toHaveCount(13);
  await expect(page.locator(".bottombar .position")).toContainText("POST /orders 2 / 13");
  // 저장소 밖에서 물려받은 메서드(JpaRepository.save)와 record 접근자도 코드 옆에 보인다
  await expect.poll(() => marks(page)).toContain("↗ OrderRepository.save");
  await expect(page.getByTestId("tour-external")).toContainText("OrderRepository.save");
  // 코드의 호출 줄 옆에 이어지는 단계 번호가 붙는다
  await expect(page.locator(".tour-mark.next").first()).toBeVisible();
  await expect.poll(() => marks(page)).toContain("→ 3단계 CouponCalculator.validateCoupon");
  await expect.poll(() => marks(page)).toContain("접음 OrderRequest.totalAmount");
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
  await expect.poll(() => marks(page)).toContain("↩ 앞 10단계");
  await expect(page.getByTestId("tour-folded")).toContainText("PaymentResult.ok");
  await shot(app, "guide-06-branch");

  // 코드 옆 "→ 12단계" 표시를 누르면 그 단계로 가고, 편집기에 초점이 있어도 Backspace로 돌아온다
  await page.locator(".tour-mark.next").first().click();
  await expect(page.getByTestId("step-title")).toHaveText("PointLedger.deduct");
  await page.locator(".view-lines").click();
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("step-title")).toHaveText("PointPaymentClient.approve");
  // 한 줄에 갈래 둘이면 표시도 둘이라 둘째를 누르면 둘째로 간다
  await page.getByTestId("tour-step").nth(1).click();
  await page.locator(".tour-mark.next").filter({ hasText: "11단계" }).first().click();
  await expect(page.getByTestId("step-title")).toHaveText("PointPaymentClient.approve");
  // 마지막 단계에서는 끝을 알리고 다음 진입점으로 가는 길을 준다
  await page.getByTestId("tour-step").nth(12).click();
  await expect(page.getByTestId("tour-end")).toContainText("투어의 마지막 단계입니다");
  await expect(page.locator(".bottombar .position")).toContainText("13 / 13, 마지막 단계");
  await page.getByTestId("tour-end").getByRole("button", { name: "다음 진입점: GET /orders/{id}" }).click();
  await expect(page.getByTestId("step-title")).toHaveText("OrderController.get");
  await page.getByTestId("entry-row").filter({ hasText: "POST /orders" }).click();
  await page.getByTestId("tour-step").nth(10).click();

  // 지도에서 보기: 이 단계의 클래스를 지도에서 고른다
  await page.getByTestId("show-on-map").click();
  await expect(page.getByRole("tab", { name: "지도" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("context-title")).toHaveText("PointPaymentClient");
  await expect(chip(page, "PointPaymentClient")).toHaveAttribute("aria-pressed", "true");
  // 같은 진입점 투어가 열려 있어도 "여기서 투어 시작"은 이 클래스 단계에서 열고 그 줄로 초점을 옮긴다
  await page.getByTestId("start-tour").click();
  await expect(page.getByTestId("step-title")).toHaveText("PointPaymentClient.approve");
  await expect(page.getByTestId("tour-step").nth(10)).toBeFocused();
  // 지도에서 보기로 초점을 옮긴 뒤에도 탭의 화살표는 초점을 탭에 둔다
  await page.getByTestId("show-on-map").click();
  await page.getByRole("tab", { name: "지도" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "투어" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "지도" })).toBeFocused();
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
  // 투어를 받은 뒤 현재 단계 줄로 초점이 간다
  await expect(second.page.getByTestId("tour-step").nth(1)).toBeFocused();
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
  // 좁은 창에서는 맥락이 지도 아래에 한 줄로 접혀 있다가 펼친다
  await expect(page.locator(".narrow-side")).toBeVisible();
  await expect(page.getByTestId("side-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.getByTestId("side-toggle").click();
  await expect(page.getByTestId("context-title")).not.toBeEmpty();
  await shot(app, "guide-08-narrow-context");
  // 탭 목록에서 오른쪽 화살표로 투어로
  await page.getByRole("tab", { name: "지도" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "투어" })).toBeFocused();
  await expect(page.getByTestId("tour-step").first()).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.locator(".bottombar .position")).toContainText("2 /");
  // 아래로 내려온 호출 스택은 접혀 있다가 펼치면 눌리지 않고 보인다
  await page.getByTestId("side-toggle").click();
  expect((await page.locator(".narrow-side").boundingBox())!.height).toBeGreaterThan(100);
  await expect(page.getByTestId("tour-stack")).toBeVisible();
  await shot(app, "guide-09-narrow-tour");
  await page.getByRole("tab", { name: "투어" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("guide-map")).toBeVisible();
  await app.close();
});

test("없는 브랜치는 그 이름으로 알리고, 돌아가면 입력이 남는다", async () => {
  const { app, page } = await launch(makeUserData());
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await page.getByLabel("둘러볼 브랜치나 커밋").fill("no-such-branch");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText('찾을 수 없는 이름: "no-such-branch"');
  await expect(page.getByRole("heading", { name: "둘러보지 못했습니다" })).toBeFocused();
  await shot(app, "guide-10-no-branch");
  await page.getByRole("button", { name: "브랜치 다시 고르기" }).click();
  await expect(page.getByLabel("둘러볼 브랜치나 커밋")).toHaveValue("no-such-branch");
  await expect(page.getByLabel("둘러볼 브랜치나 커밋")).toBeFocused();
  // "-"로 시작하는 이름은 git 옵션으로 넘기지 않고 같은 안내를 준다
  await page.getByLabel("둘러볼 브랜치나 커밋").fill("--version");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText('찾을 수 없는 이름: "--version"');
  await app.close();
});

test("큰 저장소는 디렉터리로 좁히고, 없는 디렉터리는 이유를 알린다", async () => {
  const large = makeLargeRepo();
  const { app, page } = await launch(makeUserData());
  await page.getByLabel("저장소 경로").fill(large);
  await page.getByLabel("저장소 경로").press("Enter");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await expect(page.getByTestId("guide-large")).toContainText("코드 파일이 3,002개입니다");
  await expect(page.getByRole("heading", { name: /코드 파일이/ })).toBeFocused();
  await page.getByLabel("다른 디렉터리").fill("no/such");
  await page.getByRole("button", { name: "좁혀 둘러보기" }).click();
  await expect(page.getByRole("alert")).toContainText('이 커밋에는 "no/such" 아래 Java, Kotlin 파일이 없습니다');
  await page.getByRole("button", { name: "다른 디렉터리 고르기" }).click();
  await expect(page.getByLabel("다른 디렉터리")).toHaveValue("no/such");
  await page.getByTestId("guide-large").getByRole("button", { name: /^api/ }).click();
  await expect(page.getByTestId("guide-map")).toBeVisible();
  await expect(page.getByTestId("guide-ref")).toContainText("api");
  await shot(app, "guide-11-narrowed");
  await app.close();
});
