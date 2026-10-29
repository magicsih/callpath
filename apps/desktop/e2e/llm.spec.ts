import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, makeFixtureRepo, makeUserData, openAndAnalyze, shot } from "./harness";
import { startMockLlm, type MockLlm } from "./mockLlm";

const KEY = "sk-e2e-secret-key-9876";
const chats = (m: MockLlm) => m.requests.filter((r) => r.url === "/v1/chat/completions");

test("A10 LLM: 미리보기 없이는 보내지 않고, 확인하면 보낸 그 내용으로 답을 받으며, 보낸 내용이 기록에 남는다", async () => {
  const mock = await startMockLlm();
  const data = makeUserData();
  const { app, page } = await launch(data);
  try {
    const repo = makeFixtureRepo("java");
    // 꺼져 있으면 오른쪽 영역에는 켜는 길만 보인다. 그 길로 설정하고 돌아오면 보던 위치로 온다
    await openAndAnalyze(page, repo);
    await page.keyboard.press("j");
    await expect(page.getByTestId("llm-off")).toContainText("꺼져 있습니다");
    await page.getByTestId("llm-off").getByRole("button", { name: "LLM 설정" }).click();
    await expect(page.getByRole("heading", { name: "LLM 설정" })).toBeFocused();
    await page.getByLabel("LLM 설명 쓰기").check();
    await page.getByLabel("끝점 주소").fill(mock.endpoint);
    await page.getByLabel("모델").fill("test-model");
    await page.getByLabel("API 키").fill(KEY);
    await page.getByRole("button", { name: "확인하고 저장" }).click();
    await expect(page.getByTestId("llm-saved")).toContainText("test-model 모델로 설명을 받습니다");
    // 확인은 모델 목록만 묻고 코드는 보내지 않는다
    expect(mock.requests.map((r) => r.url)).toEqual(["/v1/models"]);
    expect(mock.requests[0]!.auth).toBe(`Bearer ${KEY}`);
    // 저장한 키는 다시 보이지 않는다
    await expect(page.getByLabel("API 키")).toHaveValue("");
    await expect(page.getByLabel("API 키")).toHaveAttribute("placeholder", /저장된 키가 있습니다/);
    expect(readFileSync(join(data, "llm.json"), "utf8")).not.toContain(KEY);
    await page.getByRole("button", { name: "리뷰로 돌아가기" }).click();
    await expect(page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
    await expect(page.getByTestId("llm-actions")).toBeVisible();
    // 메서드 설명: 미리보기를 보고 취소하면 아무것도 나가지 않는다
    await page.getByRole("button", { name: "이 메서드 설명" }).click();
    const dialog = page.getByTestId("explain-dialog");
    await expect(dialog.getByTestId("explain-dest")).toContainText("test-model");
    await expect(dialog.getByTestId("explain-scope")).toContainText("OrderService.java");
    await expect(dialog.getByTestId("explain-scope")).toContainText("변경 전");
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    await shot(app, "18-llm-preview");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(chats(mock)).toHaveLength(0);

    // 흐름 요약: 보내면 답이 조각씩 오고, 보낸 내용은 미리보기와 같다
    await page.getByRole("button", { name: "이 흐름 요약" }).click();
    await expect(dialog.getByTestId("explain-scope")).toBeVisible();
    await dialog.locator("summary").click();
    const shown = await dialog.getByTestId("explain-message").allTextContents();
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByTestId("explain-stop")).toBeVisible();
    await expect(dialog.getByTestId("explain-answer")).toContainText("재고 차감이 결제 승인 앞으로 옮겨졌습니다.");
    await expect(dialog.getByRole("button", { name: "다시 요청" })).toBeVisible();
    await expect(dialog).not.toContainText("지난번에 받은 답입니다");
    await shot(app, "19-llm-answer");
    expect(chats(mock)).toHaveLength(1);
    const sent = chats(mock)[0]!.body as { model: string; messages: Array<{ content: string }> };
    expect(sent.model).toBe("test-model");
    expect(sent.messages.map((m) => m.content)).toEqual(shown);
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(page.getByRole("button", { name: /이 흐름 요약/ })).toContainText("(받음)");
    // 다시 열면 받은 답을 먼저 보인다(다시 보내지 않는다)
    await page.getByRole("button", { name: /이 흐름 요약/ }).click();
    await expect(dialog).toContainText("지난번에 받은 답입니다");
    await page.keyboard.press("Escape");
    expect(chats(mock)).toHaveLength(1);

    // 기록: 보내기 전 한 줄(보낸 내용), 끝난 뒤 한 줄(답). 키는 없다
    const log = readFileSync(join(data, "llm-log.jsonl"), "utf8");
    const lines = log.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.status)).toEqual(["sent", "done"]);
    expect(lines[0].messages.map((m: { content: string }) => m.content)).toEqual(shown);
    expect(lines[1].answer).toBe("재고 차감이 결제 승인 앞으로 옮겨졌습니다.");
    expect(log).not.toContain(KEY);

    // 좁은 창에서는 오른쪽 영역 대신 상세 머리에 버튼이 보인다
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.setContentSize(900, 600);
      w.webContents.setZoomFactor(1.5);
    });
    await expect(page.locator(".head-extra").getByRole("button", { name: /이 메서드 설명/ })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.setContentSize(1360, 860);
      w.webContents.setZoomFactor(1);
    });
    // 넓어지면 상세 머리의 버튼은 사라지고 오른쪽 영역의 버튼만 남는다
    await expect(page.locator(".head-extra")).toHaveCount(0);
    // 키가 거부되면 원인과 LLM 설정으로 가는 길을 보인다
    mock.rejectChat = true;
    await page.locator(".pane.right").getByRole("button", { name: /이 메서드 설명/ }).click();
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByTestId("explain-error")).toContainText("키가 거부되었습니다");
    await expect(dialog.getByRole("button", { name: "LLM 설정" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
    await mock.close();
  }
});
