import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
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
    await page.getByRole("button", { name: "OrderService.placeOrder 설명" }).click();
    const dialog = page.getByTestId("explain-dialog");
    await expect(dialog.getByTestId("explain-dest")).toContainText("test-model");
    await expect(dialog.getByTestId("explain-scope")).toContainText("OrderService.java");
    await expect(dialog.getByTestId("explain-scope")).toContainText("변경 전");
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    // 메시지 전체를 펼쳐도 본문만 스크롤되고 보내기 버튼은 창 안에 남는다
    await dialog.locator("summary").click();
    const body = dialog.locator(".explain-body");
    await body.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: "보내기" })).toBeInViewport();
    await dialog.locator("summary").click();
    await shot(app, "18-llm-preview");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(chats(mock)).toHaveLength(0);

    // 흐름 요약: 보내면 답이 조각씩 오고, 보낸 내용은 미리보기와 같다
    await page.getByRole("button", { name: "POST /orders 흐름 요약" }).click();
    await expect(dialog.getByTestId("explain-scope")).toBeVisible();
    await dialog.locator("summary").click();
    const shown = await dialog.getByTestId("explain-message").allTextContents();
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByTestId("explain-stop")).toBeVisible();
    await expect(dialog.getByTestId("explain-answer")).toContainText("재고 차감이 결제 승인 앞으로 옮겨졌습니다.");
    // 마크다운은 기호 대신 굵게, 목록, 줄 안 코드로 보인다
    await expect(dialog.getByTestId("explain-answer").locator("strong").first()).toHaveText("재고 차감");
    await expect(dialog.getByTestId("explain-answer").locator("li code").first()).toHaveText("approve");
    // 굵게 안의 줄 안 코드도 코드로 보인다
    await expect(dialog.getByTestId("explain-answer").locator("strong code")).toHaveText("decrease");
    await expect(dialog.getByTestId("explain-answer")).not.toContainText("**");
    await expect(dialog.getByRole("button", { name: "다시 요청" })).toBeVisible();
    await expect(dialog).not.toContainText("지난번에 받은 답입니다");
    await shot(app, "19-llm-answer");
    expect(chats(mock)).toHaveLength(1);
    const sent = chats(mock)[0]!.body as { model: string; messages: Array<{ content: string }> };
    expect(sent.model).toBe("test-model");
    expect(sent.messages.map((m) => m.content)).toEqual(shown);
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(page.getByRole("button", { name: /POST \/orders 흐름 요약/ })).toContainText("(받음)");
    // 다시 열면 받은 답을 먼저 보인다(다시 보내지 않는다)
    await page.getByRole("button", { name: /POST \/orders 흐름 요약/ }).click();
    await expect(dialog).toContainText("지난번에 받은 답입니다");
    await page.keyboard.press("Escape");
    expect(chats(mock)).toHaveLength(1);

    // 기록: 보내기 전 한 줄(보낸 내용), 끝난 뒤 한 줄(답). 키는 없다
    const log = readFileSync(join(data, "llm-log.jsonl"), "utf8");
    const lines = log.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.status)).toEqual(["sent", "done"]);
    expect(lines[0].messages.map((m: { content: string }) => m.content)).toEqual(shown);
    expect(lines[1].answer).toBe("**재고 차감**이 결제 승인 앞으로 옮겨졌습니다.\n\n- 확인할 점: `approve` 실패 시 되돌림\n- **`decrease` 먼저** 호출");
    expect(log).not.toContain(KEY);

    // 설정을 다녀와도 받은 답은 남는다(같은 커밋)
    await page.getByTestId("llm-actions").getByRole("button", { name: "LLM 설정" }).click();
    await page.getByRole("button", { name: "리뷰로 돌아가기" }).click();
    await expect(page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
    await expect(page.getByRole("button", { name: /POST \/orders 흐름 요약/ })).toContainText("(받음)");
    // 진입점 미확정 단계는 흐름 요약이 없다고 알리고, 호출 경로를 진입점이라고 보내지 않는다
    await page.getByRole("button", { name: /생성자/ }).first().click();
    await expect(page.locator(".pane.right").getByRole("button", { name: /OrderService 생성자 설명/ })).toBeVisible();
    await expect(page.getByTestId("llm-reason")).toContainText("진입점 미확정 묶음이라 흐름 요약은 없습니다");
    await page.locator(".pane.right").getByRole("button", { name: /설명$/ }).click();
    await expect(dialog.getByTestId("explain-dest")).toBeVisible();
    await expect(dialog).toContainText("진입점 미확정");
    // 제목은 미리보기 전후로 같은 이름(화면 표기)이다
    await expect(dialog.locator("#explain-title")).toHaveText("OrderService 생성자 설명");
    await expect(dialog).not.toContainText("이 메서드가 진입점");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /placeOrder/ }).first().click();
    // 좁은 창에서는 오른쪽 영역 대신 상세 머리에 버튼이 보인다
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.setContentSize(900, 600);
      w.webContents.setZoomFactor(1.5);
    });
    await expect(page.locator(".head-extra").getByRole("button", { name: /placeOrder 설명/ })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.setContentSize(1360, 860);
      w.webContents.setZoomFactor(1);
    });
    // 넓어지면 상세 머리의 버튼은 사라지고 오른쪽 영역의 버튼만 남는다
    await expect(page.locator(".head-extra")).toHaveCount(0);
    // 키가 거부되면 원인과 LLM 설정으로 가는 길을 보인다
    mock.rejectChat = true;
    await page.locator(".pane.right").getByRole("button", { name: /placeOrder 설명/ }).click();
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByTestId("explain-error")).toContainText("키가 거부되었습니다");
    await expect(dialog.getByRole("button", { name: "LLM 설정" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
    await mock.close();
  }
});

test("LLM 설정: 저장 못 하는 이유, 헤더를 바꾼다는 안내, 저장하지 않은 변경은 묻고 버린다", async () => {
  const mock = await startMockLlm();
  const { app, page } = await launch(makeUserData());
  try {
    await page.getByRole("button", { name: "LLM 설정" }).click();
    await page.getByLabel("LLM 설명 쓰기").check();
    await expect(page.getByTestId("llm-missing")).toHaveText("저장하려면 끝점 주소와 모델을 넣으세요.");
    await expect(page.getByRole("button", { name: "확인하고 저장" })).toBeDisabled();
    await page.getByLabel("끝점 주소").fill(mock.endpoint);
    await expect(page.getByTestId("llm-missing")).toHaveText("저장하려면 모델을 넣으세요.");
    await page.getByLabel("모델").fill("test-model");
    await page.getByLabel("추가 헤더 (선택)").fill("X-A: 1\nX-B: 2");
    await page.getByRole("button", { name: "확인하고 저장" }).click();
    await expect(page.getByTestId("llm-saved")).toBeVisible();
    await expect(page.getByText("저장된 헤더: X-A, X-B")).toBeVisible();
    // 새 헤더만 넣으면 저장된 헤더를 모두 바꾼다고 알린다
    await page.getByLabel("추가 헤더 (선택)").fill("X-C: 3");
    await expect(page.getByTestId("llm-headers-replace")).toContainText("X-A, X-B");
    // 저장하지 않고 돌아가려 하면 묻는다
    await page.getByRole("button", { name: "돌아가기" }).click();
    await expect(page.getByTestId("llm-leave")).toBeVisible();
    // 잃지 않는 쪽에 먼저 초점, Esc는 계속 고치기, 닫히면 돌아가기 버튼으로 초점
    await expect(page.getByRole("button", { name: "계속 고치기" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("llm-leave")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "돌아가기" })).toBeFocused();
    await expect(page.getByLabel("추가 헤더 (선택)")).toHaveValue("X-C: 3");
    await page.getByRole("button", { name: "돌아가기" }).click();
    await page.getByRole("button", { name: "버리고 돌아가기" }).click();
    await expect(page.getByRole("heading", { name: "Callpath" })).toBeVisible();
  } finally {
    await app.close();
    await mock.close();
  }
});

test("LLM 키 파일: 키를 앱에 두지 않고 이 컴퓨터의 파일에서 쓸 때마다 읽고, MiniMax로 채우기와 생각 중 표시", async () => {
  const mock = await startMockLlm();
  const data = makeUserData();
  const keyFile = join(data, "..", `llm-key-${Date.now()}.env`);
  writeFileSync(keyFile, "# 시험용\nexport TEST_LLM_KEY=\"sk-file-first-111\"\n");
  const { app, page } = await launch(data);
  try {
    await page.getByRole("button", { name: "LLM 설정" }).click();
    await page.getByLabel("LLM 설명 쓰기").check();
    // MiniMax로 채우기는 공식 OpenAI 호환 주소와 최신 모델, 키 변수 이름을 채운다
    await page.getByLabel("이 컴퓨터의 키 파일에서 읽기").check();
    await page.getByTestId("preset-minimax").click();
    await expect(page.getByLabel("끝점 주소")).toHaveValue("https://api.minimax.io/v1");
    await expect(page.getByLabel("모델")).toHaveValue("MiniMax-M3.1-Flash");
    await expect(page.getByLabel("변수 이름")).toHaveValue("MINIMAX_API_KEY");
    // 시험은 모의 끝점과 시험용 키 파일로 한다
    await page.getByLabel("끝점 주소").fill(mock.endpoint);
    await page.getByLabel("모델").fill("test-model");
    await page.getByLabel("키 파일 경로").fill(keyFile);
    await page.getByLabel("변수 이름").fill("NO_SUCH_KEY");
    await page.getByRole("button", { name: "확인하고 저장" }).click();
    await expect(page.getByTestId("llm-error")).toContainText("NO_SUCH_KEY 값이 없습니다");
    await expect(page.getByLabel("키 파일 경로")).toBeFocused();
    await page.getByLabel("변수 이름").fill("TEST_LLM_KEY");
    await page.getByRole("button", { name: "확인하고 저장" }).click();
    await expect(page.getByTestId("llm-saved")).toBeVisible();
    await expect(page.getByTestId("llm-keyfile-status")).toHaveText("파일에서 키를 찾았습니다");
    expect(mock.requests.at(-1)!.auth).toBe("Bearer sk-file-first-111");
    const saved = readFileSync(join(data, "llm.json"), "utf8");
    expect(saved).toContain("TEST_LLM_KEY");
    expect(saved).not.toContain("sk-file-first-111");
    await page.getByRole("button", { name: "돌아가기" }).click();

    // 파일의 키를 바꾸면 다음 요청부터 새 키를 쓴다
    writeFileSync(keyFile, "export TEST_LLM_KEY=sk-file-second-222\n");
    mock.reasoning = true;
    await openAndAnalyze(page, makeFixtureRepo("java"));
    await page.keyboard.press("j");
    await page.locator(".pane.right").getByRole("button", { name: /placeOrder 설명/ }).click();
    const dialog = page.getByTestId("explain-dialog");
    await dialog.getByRole("button", { name: "보내기" }).click();
    await expect(dialog.getByTestId("explain-answer")).toContainText("모델이 답을 생각하는 중");
    await expect(dialog.getByTestId("explain-answer")).toContainText("재고 차감이 결제 승인 앞으로 옮겨졌습니다.");
    await expect(dialog.getByTestId("explain-answer")).not.toContainText("생각 중");
    expect(chats(mock).at(-1)!.auth).toBe("Bearer sk-file-second-222");
    const log = readFileSync(join(data, "llm-log.jsonl"), "utf8");
    expect(log).not.toContain("sk-file-");
    expect(log).not.toContain("생각 중");
  } finally {
    await app.close();
    await mock.close();
  }
});
