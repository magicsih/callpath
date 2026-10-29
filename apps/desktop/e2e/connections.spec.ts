import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, makeFixtureRepo, makeUserData, shot } from "./harness";
import { GOOD_TOKEN, startMockGithub } from "./mockGithub";

async function addGhe(page: Page, host: string, token: string) {
  await page.getByRole("radio", { name: "GitHub Enterprise" }).check();
  await page.getByLabel("호스트").fill(host);
  await page.getByLabel("토큰").fill(token);
  await page.getByRole("button", { name: "연결 저장" }).click();
}

test("A15 연결 저장: 잘못된 토큰은 원인과 함께 실패, 맞는 토큰은 확인 뒤 암호화해 저장하고 다시 보여주지 않는다", async () => {
  const mock = await startMockGithub();
  const data = makeUserData();
  const { app, page } = await launch(data);
  try {
    await page.getByRole("button", { name: "연결 설정" }).click();
    await expect(page.getByText("연결된 계정이 없습니다.")).toBeVisible();
    // 들어오면 제목에 초점이 있다
    await expect(page.getByRole("heading", { name: "연결 설정" })).toBeFocused();
    // 답하지 않는 호스트는 경과 시간과 함께 기다리고, 멈추면 저장하지 않는다
    const { createServer } = await import("node:http");
    const silent = createServer(() => undefined);
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", () => r()));
    try {
      await addGhe(page, `http://127.0.0.1:${(silent.address() as { port: number }).port}`, "hang-token");
      await expect(page.getByTestId("conn-checking")).toContainText("최대 30초");
      await page.getByRole("button", { name: "확인 멈추기" }).click();
      await expect(page.getByText("확인을 멈췄습니다. 저장하지 않았습니다")).toBeVisible();
      await expect(page.getByText("연결된 계정이 없습니다.")).toBeVisible();
    } finally {
      silent.closeAllConnections();
      silent.close();
    }
    // CI의 Linux에는 암호 저장소가 없어(--password-store=basic) 저장 전에 약한 보관을 알린다
    await page.getByRole("radio", { name: "GitHub Enterprise" }).check();
    if (process.platform === "linux") await expect(page.getByTestId("weak-storage")).toBeVisible();
    else await expect(page.getByTestId("weak-storage")).toHaveCount(0);
    // 닿지 않는 호스트는 주소만 고치면 되므로 토큰을 남기고 호스트 칸으로 초점을 돌린다
    await addGhe(page, "http://127.0.0.1:1", "kept-token");
    await expect(page.getByTestId("conn-error")).toContainText("사내망(VPN)");
    await expect(page.getByLabel("토큰")).toHaveValue("kept-token");
    await expect(page.getByLabel("호스트")).toBeFocused();
    await addGhe(page, mock.url, "wrong-token");
    await expect(page.getByTestId("conn-error")).toContainText("토큰이 거부되었습니다");
    await expect(page.getByLabel("토큰")).toHaveValue("");
    await expect(page.getByLabel("토큰")).toBeFocused();
    await addGhe(page, mock.url, GOOD_TOKEN);
    await expect(page.getByTestId("conn-saved")).toContainText("reviewer로 연결했습니다");
    await expect(page.getByTestId("connections")).toContainText("reviewer로 확인됨");
    await expect(page.getByLabel("토큰")).toHaveValue("");
    await shot(app, "14-connections");
    // 저장 파일에 토큰 원문이 없다
    const saved = readFileSync(join(data, "connections.json"), "utf8");
    expect(saved).not.toContain(GOOD_TOKEN);
    expect(saved).not.toContain("wrong-token");
    expect(saved).not.toContain("kept-token");
    // 지우기는 한 번 더 확인한다
    await page.getByRole("button", { name: /연결 지우기$/ }).click();
    await expect(page.getByTestId("connections")).toBeVisible();
    await page.getByRole("button", { name: /연결 지우기 확인$/ }).click();
    await expect(page.getByText("연결된 계정이 없습니다.")).toBeVisible();
  } finally {
    await app.close();
    await mock.close();
  }
});

test("PR 열기: 연결이 없으면 연결 설정으로 안내하고, 연결하면 주소로 열어 흐름을 본다. 다시 열면 서버 없이 복원한다", async () => {
  const mock = await startMockGithub();
  const data = makeUserData();
  const first = await launch(data);
  const page = first.page;
  try {
    // 형식이 틀린 주소는 시작 화면의 입력 아래에 원인을 보이고 입력을 남긴다
    await page.getByLabel("PR 주소").fill("https://example.com/shop/order/issues/1");
    await page.getByRole("button", { name: "PR 열기" }).click();
    await expect(page.getByTestId("pr-url-error")).toContainText("PR 주소를 읽지 못했습니다");
    await expect(page.getByLabel("PR 주소")).toHaveValue("https://example.com/shop/order/issues/1");
    await page.getByLabel("PR 주소").fill(mock.prUrl);
    await page.getByRole("button", { name: "PR 열기" }).click();
    await expect(page.getByTestId("pr-error")).toContainText("연결하지 않았습니다");
    await page.getByRole("button", { name: "연결 설정" }).click();
    // PR 주소에서 제공자와 호스트를 채워 둔다
    await expect(page.getByRole("radio", { name: "GitHub Enterprise" })).toBeChecked();
    await expect(page.getByLabel("호스트")).toHaveValue(mock.url);
    await page.getByLabel("토큰").fill(GOOD_TOKEN);
    await page.getByRole("button", { name: "연결 저장" }).click();
    await expect(page.getByTestId("conn-saved")).toBeVisible();
    // 연결 설정에서 돌아오면 같은 PR을 다시 연다. 버튼 이름이 그렇게 알린다
    await page.getByRole("button", { name: "돌아가서 PR 다시 열기" }).click();
    await expect(page.getByTestId("pr-chip")).toHaveText("#1 쿠폰 할인", { timeout: 60_000 });
    await expect(page.getByTestId("detail-title")).toHaveText("OrderController.place");
    await expect(page.locator(".group-title").first()).toContainText("POST /orders");
    await page.keyboard.press("j");
    await shot(first.app, "15-pr-review");
    for (const [w, h, zoom] of [[900, 600, 1], [1280, 800, 1.5], [900, 600, 1.5]] as const) {
      await first.app.evaluate(({ BrowserWindow }, [w, h, zoom]) => {
        const win = BrowserWindow.getAllWindows()[0]!;
        win.setContentSize(w, h);
        win.webContents.setZoomFactor(zoom);
      }, [w, h, zoom] as const);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const bar = document.querySelector(".toolbar")!;
            const right = Math.max(...[...bar.querySelectorAll("button")].map((b) => b.getBoundingClientRect().right));
            return bar.scrollWidth <= bar.clientWidth + 1 && right <= window.innerWidth + 1;
          }),
          { message: `${w}x${h} 확대 ${zoom}` },
        )
        .toBe(true);
      // 상단 바가 두 줄이 되어도 코드가 보일 자리가 남는다
      await expect.poll(async () => (await page.locator(".diff-wrap").boundingBox())?.height ?? 0).toBeGreaterThan(120);
      // 가운데 영역과 창 안에 코드 줄이 하나 이상 보인다
      await expect
        .poll(() =>
          page.evaluate(() => {
            const pane = document.querySelector(".pane.center")!.getBoundingClientRect();
            return [...document.querySelectorAll("[data-testid=diff] .view-line")].some((e) => {
              const b = e.getBoundingClientRect();
              return b.height > 0 && b.top >= pane.top && b.bottom <= Math.min(pane.bottom, window.innerHeight) && b.left < Math.min(pane.right, window.innerWidth);
            });
          }),
        )
        .toBe(true);
    }
    await shot(first.app, "15b-pr-toolbar-small");
  } finally {
    await first.app.close();
    await mock.close();
  }
  // 서버를 끈 뒤 다시 열어도 받아 둔 코드로 PR 리뷰를 복원한다
  const second = await launch(data);
  await expect(second.page.getByTestId("pr-chip")).toHaveText("#1 쿠폰 할인");
  await expect(second.page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  await second.page.getByRole("button", { name: "다른 저장소나 PR" }).click();
  await expect(second.page.getByRole("button", { name: /#1 쿠폰 할인/ })).toBeVisible();
  await second.app.close();
});

test("비교 선택 화면에 이 저장소의 열린 PR이 보이고 눌러서 연다", async () => {
  const mock = await startMockGithub();
  const { app, page } = await launch(makeUserData());
  try {
    const repo = makeFixtureRepo("java");
    execFileSync("git", ["-C", repo, "remote", "add", "origin", `${mock.url}/shop/order.git`]);
    await page.getByRole("button", { name: "연결 설정" }).click();
    await addGhe(page, mock.url, GOOD_TOKEN);
    await expect(page.getByTestId("conn-saved")).toBeVisible();
    await page.getByRole("button", { name: "돌아가기" }).click();
    await page.getByLabel("저장소 경로").fill(repo);
    await page.getByLabel("저장소 경로").press("Enter");
    await expect(page.getByTestId("open-prs")).toContainText("#1 쿠폰 할인");
    await page.getByTestId("open-prs").getByRole("button", { name: /#1 쿠폰 할인/ }).click();
    await expect(page.getByTestId("pr-chip")).toHaveText("#1 쿠폰 할인", { timeout: 60_000 });
  } finally {
    await app.close();
    await mock.close();
  }
});

test("원격이 있지만 연결이 없으면 열린 PR 자리에 연결 안내가 보인다", async () => {
  const { app, page } = await launch(makeUserData());
  const repo = makeFixtureRepo("java");
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/example/order.git"]);
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByTestId("open-prs")).toContainText("github.com PR을 보려면 연결이 필요합니다");
  await app.close();
});
