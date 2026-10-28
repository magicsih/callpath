import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { launch, makeFixtureRepo, makeTempDir, makeUserData, openAndAnalyze, shot } from "./harness";

const repo = makeFixtureRepo("java");

test("A12 시작 화면: 최근 저장소 없음, Git 저장소가 아닌 경로의 오류", async () => {
  const { app, page } = await launch(makeUserData());
  await expect(page.getByText("최근 연 저장소가 없습니다.")).toBeVisible();
  await shot(app, "01-start-empty");
  await page.getByLabel("저장소 경로").fill("/");
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByRole("alert")).toContainText("Git 저장소가 아닙니다");
  await shot(app, "02-start-error");
  await page.getByLabel("저장소 경로").fill("/no/such/callpath/dir");
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByRole("alert")).toContainText("폴더를 찾을 수 없습니다");
  // 커밋이 없는 저장소는 비교 선택에서 이유와 다시 읽기를 보인다
  const empty = makeTempDir("callpath-e2e-empty-");
  execFileSync("git", ["-C", empty, "init", "-q", "-b", "main"]);
  await page.getByLabel("저장소 경로").fill(empty);
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByTestId("no-branches")).toContainText("비교할 브랜치가 없습니다");
  await expect(page.getByRole("button", { name: "다시 읽기" })).toBeVisible();
  await app.close();
});

test("A14 A6 키보드만으로 진입점부터 흐름을 따라 읽는다", async () => {
  const { app, page } = await launch(makeUserData());
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // 시작 화면은 경로 입력에 초점이 있다
  await expect(page.getByLabel("저장소 경로")).toBeFocused();
  await page.keyboard.type(repo);
  await page.keyboard.press("Enter");
  // 비교 선택은 기본값(main ← feature/coupon)으로 채워지고 흐름 분석 버튼에 초점이 있다
  await expect(page.getByLabel("기준 (base)")).toHaveValue("main");
  await expect(page.getByLabel("리뷰할 변경 (head)")).toHaveValue("feature/coupon");
  await shot(app, "03-compare");
  await page.keyboard.press("Enter");
  await page.getByTestId("step-row").first().waitFor();

  const title = page.getByTestId("detail-title");
  const position = page.getByTestId("position");
  await expect(title).toHaveText("OrderController.place");
  await expect(position).toContainText("POST /orders · 1 / 5");
  // 바뀌지 않은 진입점은 한 칸 보기, 흐름 제목에 순서 변경 수
  await expect(page.locator('[data-view="context"]')).toBeVisible();
  await expect(page.getByTestId("group-moved").first()).toContainText("순서 변경 1");

  await page.keyboard.press("j");
  await expect(title).toHaveText("OrderService.placeOrder");
  await expect(position).toContainText("POST /orders · 2 / 5");
  await expect(page.getByTestId("call-order")).toContainText("approve 호출이 decrease 다음으로 옮겨졌습니다");
  await expect(page.getByTestId("stack")).toContainText("OrderController.place");
  await expect(page.getByTestId("announce")).toContainText("순서 변경");
  await page.waitForTimeout(400);
  // 줄 번호 옆 표시가 글꼴 없는 네모로 나오지 않도록 Monaco 아이콘 글꼴이 있어야 한다
  expect(await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "codicon"))).toBe(true);
  await shot(app, "04-review-placeOrder");

  // Enter는 첫 다음 단계로, Backspace는 직전 위치로
  await page.keyboard.press("Enter");
  await expect(title).toHaveText("CouponCalculator.validateCoupon");
  await expect(page.locator('[data-view="added"]')).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(title).toHaveText("OrderService.placeOrder");

  for (let i = 0; i < 3; i++) await page.keyboard.press("j");
  await expect(title).toHaveText("PaymentClient.approve");
  await expect(position).toContainText("POST /orders · 5 / 5");

  // 접근성 이름: 흐름 목록, 현재 줄, 테스트 표시 체크박스
  const list = page.getByRole("navigation", { name: "흐름 목록" });
  await expect(list.locator('[aria-current="true"]')).toContainText("approve");
  await expect(list.locator('[aria-current="true"]')).toContainText("PaymentClient");
  await expect(page.getByRole("checkbox", { name: "테스트 표시" })).toBeVisible();
  // 체크박스에 초점이 있어도 t가 동작한다
  await page.getByRole("checkbox", { name: "테스트 표시" }).focus();
  await page.keyboard.press("t");
  await expect(page.getByRole("checkbox", { name: "테스트 표시" })).toBeChecked();
  // 단계를 오가는 동안 처리되지 않은 페이지 오류가 없어야 한다
  for (let i = 0; i < 6; i++) await page.keyboard.press("k");
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test("A5 테스트는 기본으로 숨기고 t로 켜면 부르는 단계 아래에 붙는다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, repo);
  await expect(page.getByTestId("test-row")).toHaveCount(0);
  await expect(page.getByTestId("hidden-tests")).toHaveText("숨긴 테스트 파일 1개");
  await page.keyboard.press("t");
  await expect(page.getByTestId("test-row")).toHaveCount(3);
  await expect(page.getByTestId("hidden-tests")).toHaveCount(0);
  // placeOrder 바로 뒤가 그 테스트다
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.getByTestId("detail-title")).toHaveText(/placeOrder(PaysTotalAmount|AppliesCouponDiscount)/);
  await expect(page.locator(".detail-head")).toContainText("테스트");
  await page.waitForTimeout(400);
  await shot(app, "05-tests-on");
  await app.close();
});

test("A7 다시 열면 저장소, 비교, 위치, 테스트 표시를 복원한다", async () => {
  const data = makeUserData();
  const first = await launch(data);
  await openAndAnalyze(first.page, repo);
  // 빠르게 여러 번 넘겨 저장 요청이 겹쳐도 상태 파일이 깨지지 않아야 한다
  for (let i = 0; i < 6; i++) await first.page.keyboard.press("j");
  for (let i = 0; i < 5; i++) await first.page.keyboard.press("k");
  await first.page.keyboard.press("t");
  await expect(first.page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  await first.page.waitForTimeout(300);
  await first.app.close();

  const second = await launch(data);
  await expect(second.page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  await expect(second.page.getByTestId("test-row")).toHaveCount(3);
  await second.app.close();
});

test("A12 리뷰 화면: 분석 중, 변경 없음, 분석 실패", async () => {
  const { app, page } = await launch(makeUserData(), { CALLPATH_ANALYZE_DELAY_MS: "2500" });
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await page.getByLabel("기준 (base)").fill("main");
  await page.getByLabel("리뷰할 변경 (head)").fill("main");
  await page.getByRole("button", { name: "흐름 분석" }).click();
  await expect(page.getByTestId("state-loading")).toBeVisible();
  await shot(app, "06-state-loading");
  await expect(page.getByTestId("state-empty")).toBeVisible({ timeout: 15_000 });
  await shot(app, "07-state-empty");

  await page.getByRole("button", { name: "비교 바꾸기" }).first().click();
  await page.getByLabel("리뷰할 변경 (head)").fill("no-such-branch");
  await page.getByRole("button", { name: "흐름 분석" }).click();
  await expect(page.getByTestId("state-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("state-error")).toContainText("찾을 수 없는 이름: \"no-such-branch\"");
  // 비교를 바꿔야 하는 실패라 주 행동은 비교 바꾸기다
  await expect(page.locator(".state button.primary")).toHaveText("비교 바꾸기");
  await shot(app, "08-state-error");
  await app.close();
});

test("A13 창 900x600과 확대 150%에서 영역이 겹치지 않고 diff와 호출 경로가 보인다", async () => {
  const { app, page } = await launch(makeUserData());
  await openAndAnalyze(page, repo);
  await page.keyboard.press("j");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.setContentSize(900, 600);
    w.webContents.setZoomFactor(1.5);
  });
  await page.waitForTimeout(800);
  await shot(app, "09-small-zoom");
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const vw = await page.evaluate(() => window.innerWidth);
  const vh = await page.evaluate(() => window.innerHeight);
  const [left, center] = [await box(".pane.left"), await box(".pane.center")];
  expect(left.x + left.width).toBeLessThanOrEqual(center.x + 1);
  for (const p of [left, center]) {
    expect(p.x + p.width).toBeLessThanOrEqual(vw + 1);
    expect(p.y + p.height).toBeLessThanOrEqual(vh + 1);
  }
  expect(center.width).toBeGreaterThan(300);
  // 좁은 창에서는 오른쪽 영역 대신 가운데 위에 호출 경로가 한 줄로 보인다
  await expect(page.locator(".pane.right")).toBeHidden();
  await expect(page.getByLabel("호출 경로")).toContainText("OrderController.place › OrderService.placeOrder");
  const diff = await box(".diff-wrap");
  expect(diff.height).toBeGreaterThan(120);
  await expect(page.getByRole("button", { name: "다음 항목" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "이전 항목" })).toBeInViewport();
  await expect(page.getByTestId("detail-title")).toBeInViewport();
  // 낮은 창에서는 호출 순서 띠가 요약으로 접히고 diff가 보인다
  await expect(page.getByRole("button", { name: "호출 목록 보기" })).toBeVisible();
  await expect(page.getByTestId("diff")).toBeInViewport();
  await app.close();
});
