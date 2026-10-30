import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, makeShopRepo, makeUserData, shot } from "./harness";
import { startMockLlm, type MockLlm } from "./mockLlm";

const KEY = "sk-e2e-guide-key-4321";
const chats = (m: MockLlm) => m.requests.filter((r) => r.url === "/v1/chat/completions");

test("B11 둘러보기 LLM 설명: 미리보기 없이는 보내지 않고, 패키지 설명에는 메서드 본문이 없다", async () => {
  const mock = await startMockLlm();
  const data = makeUserData();
  const { app, page } = await launch(data);
  try {
    await page.getByLabel("저장소 경로").fill(makeShopRepo());
    await page.getByLabel("저장소 경로").press("Enter");
    await page.getByRole("button", { name: "둘러보기", exact: true }).click();
    await page.locator('[data-testid="map-chip"][data-class-id$=".OrderService"]').click();
    await expect(page.getByTestId("context-title")).toHaveText("OrderService");

    // 꺼져 있으면 맥락 아래에 켜는 길만 보인다. 설정을 다녀오면 고른 클래스가 그대로 있다
    await expect(page.getByTestId("llm-off")).toContainText("꺼져 있습니다");
    await page.getByTestId("llm-off").getByRole("button", { name: "LLM 설정" }).click();
    await page.getByLabel("LLM 설명 쓰기").check();
    await page.getByLabel("끝점 주소").fill(mock.endpoint);
    await page.getByLabel("모델").fill("test-model");
    await page.getByLabel("API 키").fill(KEY);
    await page.getByRole("button", { name: "확인하고 저장" }).click();
    await expect(page.getByTestId("llm-saved")).toContainText("test-model");
    await page.getByRole("button", { name: "둘러보기로 돌아가기" }).click();
    await expect(page.getByTestId("context-title")).toHaveText("OrderService");
    await expect(page.getByTestId("llm-actions")).toBeVisible();

    // 클래스 설명: 미리보기를 보고 취소하면 아무것도 나가지 않는다
    const dialog = page.getByTestId("explain-dialog");
    await page.getByTestId("llm-actions").getByRole("button", { name: /OrderService 설명/ }).click();
    await expect(dialog.getByTestId("explain-scope")).toContainText("OrderService.java");
    await expect(dialog.getByTestId("explain-scope")).toContainText("현재 코드");
    await expect(dialog.getByTestId("explain-summary")).toContainText("부르는 쪽: OrderController");
    await expect(dialog.getByTestId("explain-summary")).toContainText("이 클래스를 지나는 진입점: POST /orders");
    await shot(app, "guide-12-llm-class-preview");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(chats(mock)).toHaveLength(0);

    // 보내면 미리보기의 그 내용(클래스 현재 코드)이 나가고 답을 받는다
    await page.getByTestId("llm-actions").getByRole("button", { name: /OrderService 설명/ }).click();
    await dialog.locator("summary").click();
    const shown = await dialog.getByTestId("explain-message").allTextContents();
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByTestId("explain-answer")).toContainText("재고 차감이 결제 승인 앞으로 옮겨졌습니다.");
    const sentClass = chats(mock)[0]!.body as { messages: Array<{ content: string }> };
    expect(sentClass.messages.map((m) => m.content)).toEqual(shown);
    expect(sentClass.messages[1]!.content).toContain("public OrderResult placeOrder(OrderRequest request)");
    expect(sentClass.messages[1]!.content).toContain("(현재 코드)");
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(page.getByTestId("llm-actions").getByRole("button", { name: /OrderService 설명/ })).toContainText("(받음)");

    // 패키지 설명: 코드를 보내지 않는다고 밝히고, 공개 메서드 시그니처와 연결 수만 보낸다
    await page.getByTestId("llm-actions").getByRole("button", { name: "order 패키지 설명" }).click();
    await expect(dialog.getByTestId("explain-no-code")).toBeVisible();
    await expect(dialog.getByTestId("explain-summary")).toContainText("OrderService [서비스, 클래스]: placeOrder(OrderRequest), find(long)");
    await expect(dialog.getByTestId("explain-summary")).toContainText("이 패키지가 부르는 패키지(호출 수)");
    await shot(app, "guide-13-llm-package-preview");
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByTestId("explain-answer")).toContainText("옮겨졌습니다.");
    const sentPkg = (chats(mock)[1]!.body as { messages: Array<{ content: string }> }).messages[1]!.content;
    // 메서드 본문(코드 블록, 본문에만 있는 문장)이 없다
    expect(sentPkg).not.toContain("```");
    expect(sentPkg).not.toContain("coupons.validateCoupon");
    expect(sentPkg).not.toContain("orders.save(");
    await dialog.getByRole("button", { name: "닫기" }).click();

    // 기록에는 둘 다 남고 키는 없다
    const log = readFileSync(join(data, "llm-log.jsonl"), "utf8");
    const kinds = log.trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.status === "sent").map((l) => l.kind);
    expect(kinds).toEqual(["class", "package"]);
    expect(log).not.toContain(KEY);
  } finally {
    await mock.close();
    await app.close();
  }
});
