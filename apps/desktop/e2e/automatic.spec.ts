import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, makeFixtureRepo, makeShopRepo, makeUserData, openAndAnalyze, shot } from "./harness";
import { startMockLlm, type MockLlm } from "./mockLlm";

const calls = (m: MockLlm) => m.requests.filter(r => r.url === "/v1/chat/completions" && JSON.stringify(r.body).includes("CALLPATH_CODE_NOTES_V1"));
async function configure(page: Page, endpoint: string) {
  const r = await page.evaluate(async endpoint => window.callpath.saveLlmSettings({ enabled: true, endpoint, model: "test-model", apiKey: "sk-auto-test-key" }), endpoint);
  expect(r.ok).toBe(true);
}
async function guide(page: Page, repo: string) {
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await page.getByRole("button", { name: "둘러보기", exact: true }).click();
  await page.getByTestId("guide-map").waitFor();
}

test("가상 주석: 클래스와 각 줄을 자동 설명하고 원본 코드와 줄 번호를 보존하며 재실행에서 캐시를 쓴다", async () => {
  const mock = await startMockLlm(), data = makeUserData(), repo = makeShopRepo();
  const path = join(repo, "src/main/java/com/example/shop/order/OrderService.java");
  const original = readFileSync(path, "utf8");
  let { app, page } = await launch(data);
  try {
    await configure(page, mock.endpoint);
    await guide(page, repo);
    const chip = page.locator('[data-testid="map-chip"][data-class-id$=".OrderService"]');
    await chip.click(); await chip.click();
    await expect(page.getByTestId("automatic-status")).toHaveText(/설명 준비됨|저장된 설명/);
    await expect(page.locator('.reading-note.class').first()).toContainText("이 클래스는 주문 처리");
    await expect(page.locator('.reading-note').filter({ hasText: "재고를 차감" })).toHaveCount(1);
    expect(await page.getByTestId("reading-note").count()).toBeGreaterThan(6);
    expect(await page.locator('.view-lines').innerText()).not.toContain("가상 주석");
    expect(readFileSync(path, "utf8")).toBe(original);
    await shot(app, "inline-01-class");
    await page.getByLabel("가상 주석", { exact: true }).uncheck();
    await expect(page.getByTestId("reading-note")).toHaveCount(0);
    await page.getByLabel("가상 주석", { exact: true }).check();
    await expect(page.getByTestId("reading-note").first()).toBeVisible();
    const count = calls(mock).length;
    await app.close();
    ({ app, page } = await launch(data));
    await page.locator('[data-testid="map-chip"][data-class-id$=".OrderService"]').click();
    await expect(page.getByTestId("automatic-status")).toHaveText("저장된 설명");
    expect(calls(mock)).toHaveLength(count);
    const log = readFileSync(join(data, "llm-log.jsonl"), "utf8");
    expect(log).not.toContain("sk-auto-test-key");
    expect(mock.maxAutomaticActive).toBe(1);
  } finally { await app.close(); await mock.close(); }
});

test("지도 흐름: 단계 설명과 지도 표시를 잇고 선택한 단계 코드를 자동 설명한다", async () => {
  const mock = await startMockLlm(); const { app, page } = await launch(makeUserData());
  try {
    await configure(page, mock.endpoint); await guide(page, makeShopRepo());
    await page.getByLabel("설명할 진입점").selectOption({ label: "POST /orders" });
    const panel = page.getByTestId("flow-reading");
    await expect(panel.getByTestId("flow-step-explanation")).toContainText("이 흐름을 이어갑니다");
    const step = panel.getByRole("button", { name: /OrderService.placeOrder/ }).first();
    await step.click();
    await expect(page.getByTestId("context-title")).toHaveText("OrderService");
    await expect(page.locator('.map-flow-numbers').first()).toBeVisible();
    await shot(app, "inline-02-map-flow");
    mock.automaticDelay = 25;
    await panel.getByRole("button", { name: "이 단계 코드 읽기", exact: true }).click();
    await expect(page.getByTestId("automatic-status")).toHaveText(/설명 준비됨|저장된 설명/);
    await expect(page.locator(".reading-note:visible").first()).toBeVisible();
    await expect(page.locator('.view-line').filter({ hasText: /public.*OrderResult.*placeOrder/ }).first()).toBeInViewport();
    await expect(page.getByRole("region", { name: "코드 가상 주석", exact: true })).toContainText("이 클래스는 주문 처리");
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(900, 600); w.webContents.setZoomFactor(1.5); });
    await expect(page.getByLabel("가상 주석", { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.locator('.automatic-content').evaluate(el => el.querySelector('.monaco-editor')!.getBoundingClientRect().width <= el.getBoundingClientRect().width + 1)).toBe(true);
    await expect.poll(() => page.locator('.reading-note:visible').evaluateAll(nodes =>
      nodes.every(n => n.firstElementChild!.getBoundingClientRect().height <= n.getBoundingClientRect().height),
    )).toBe(true);
    await shot(app, "inline-03-small-zoom");
  } finally { await app.close(); await mock.close(); }
});

test("자동 설명: diff 이전과 이후를 구분하고 끈 상태에서는 요청하지 않으며 중단과 오류에서 코드를 유지한다", async () => {
  const mock = await startMockLlm(); const { app, page } = await launch(makeUserData());
  try {
    await openAndAnalyze(page, makeFixtureRepo());
    await page.keyboard.press("j");
    expect(calls(mock)).toHaveLength(0);
    await page.getByTestId("llm-off").getByRole("button", { name: "LLM 설정" }).click();
    await page.getByLabel("LLM 설명 쓰기").check();
    await page.getByLabel("끝점 주소").fill(mock.endpoint); await page.getByLabel("모델").fill("test-model");
    await page.getByRole("button", { name: "확인하고 저장" }).click();
    await page.getByRole("button", { name: "리뷰로 돌아가기" }).click();
    await expect(page.getByTestId("automatic-status")).toHaveText("설명 준비됨");
    expect(await page.locator('.reading-note[data-source="base"]').count()).toBeGreaterThan(0);
    expect(await page.locator('.reading-note[data-source="head"]').count()).toBeGreaterThan(0);
    mock.automaticDelay = 200;
    await page.getByTestId("automatic-bar").getByRole("button", { name: "다시 작성", exact: true }).click();
    await expect.poll(() => calls(mock).length).toBeGreaterThan(1);
    await page.getByTestId("automatic-bar").getByRole("button", { name: "멈추기", exact: true }).click();
    await expect(page.getByTestId("automatic-status")).toHaveText("설명 작성 중단");
    await expect(page.getByTestId("diff")).toBeVisible();
    mock.automaticDelay = 0; mock.automaticReply = '{"source":"other","line":99999,"kind":"line","text":"잘못된 설명"}\n';
    await page.getByTestId("automatic-bar").getByRole("button", { name: "다시 작성", exact: true }).click();
    await expect(page.getByTestId("automatic-status")).toHaveText("설명 작성 실패");
    await expect(page.getByTestId("diff")).not.toContainText("잘못된 설명");
    await expect(page.getByTestId("diff")).toBeVisible();
  } finally { await app.close(); await mock.close(); }
});
