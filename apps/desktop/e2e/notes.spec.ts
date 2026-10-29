import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { launch, makeFixtureRepo, makeUserData, openAndAnalyze, shot } from "./harness";
import { GOOD_TOKEN, startMockGithub } from "./mockGithub";

async function addNote(page: Page, text: string) {
  await page.keyboard.press("m");
  await expect(page.getByTestId("composer")).toBeVisible();
  await page.getByTestId("composer").getByRole("textbox").fill(text);
  await page.getByTestId("composer").getByRole("textbox").press("ControlOrMeta+Enter");
  await expect(page.getByTestId("composer")).toHaveCount(0);
}

test("A16 메모: m으로 남기면 줄 옆과 목록에 보이고, 목록에서 그 단계로 가며, 다시 열어도 남고, 새 커밋 뒤에는 이전 커밋 메모로 보인다", async () => {
  const data = makeUserData();
  const repo = makeFixtureRepo("java");
  const first = await launch(data);
  const page = first.page;
  await openAndAnalyze(page, repo);
  await page.keyboard.press("j");
  await expect(page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  await addNote(page, "결제 실패 시 재고 복구가 없습니다");
  await expect(page.getByTestId("notes-toggle")).toHaveText("메모 1");
  await expect(page.locator(".memo-glyph").first()).toBeVisible();
  // 다른 단계로 갔다가 목록에서 메모를 누르면 그 단계로 돌아온다
  await page.keyboard.press("j");
  await page.getByTestId("notes-toggle").click();
  await expect(page.getByTestId("note-row")).toContainText("OrderService.java:17");
  await expect(page.getByTestId("note-row")).toContainText("결제 실패 시 재고 복구가 없습니다");
  // 로컬 비교에는 게시 버튼이 없다
  await expect(page.getByTestId("post-open")).toHaveCount(0);
  await expect(page.getByTestId("notes-drawer")).toContainText("이 컴퓨터에만 남습니다");
  await page.getByTestId("note-row").getByRole("button").first().click();
  await expect(page.getByTestId("detail-title")).toHaveText("OrderService.placeOrder");
  await page.waitForTimeout(300);
  await shot(first.app, "16-notes");
  await first.app.close();

  const second = await launch(data);
  await expect(second.page.getByTestId("notes-toggle")).toHaveText("메모 1");
  // 변경 브랜치에 커밋이 더해지면 그 메모는 줄이 달라졌을 수 있어 이전 커밋 메모로 따로 보인다
  appendFileSync(join(repo, "src/main/java/shop/order/OrderService.java"), "\n// 후속 커밋\n");
  execFileSync("git", ["-C", repo, "-c", "user.email=e2e@callpath.test", "-c", "user.name=e2e", "commit", "-qam", "후속"]);
  await second.page.getByRole("button", { name: "다시 분석" }).click();
  await expect(second.page.getByTestId("notes-toggle")).toHaveText("메모 0");
  await second.page.getByTestId("notes-toggle").click();
  await expect(second.page.getByTestId("note-row")).toHaveCount(0);
  await expect(second.page.getByTestId("note-stale")).toContainText("결제 실패 시 재고 복구가 없습니다");
  await expect(second.page.getByTestId("notes-drawer")).toContainText("이전 커밋에 남긴 메모 1");
  await second.app.close();
});

test("A17 게시: diff 안 줄은 줄 코멘트, 밖 줄은 일반 코멘트로 미리보기에서 확인하고 올리면 게시됨으로 바뀐다", async () => {
  const mock = await startMockGithub();
  const { app, page } = await launch(makeUserData());
  try {
    await page.getByRole("button", { name: "연결 설정" }).click();
    await page.getByRole("radio", { name: "GitHub Enterprise" }).check();
    await page.getByLabel("호스트").fill(mock.url);
    await page.getByLabel("토큰").fill(GOOD_TOKEN);
    await page.getByRole("button", { name: "연결 저장" }).click();
    await expect(page.getByTestId("conn-saved")).toBeVisible();
    await page.getByRole("button", { name: "돌아가기" }).click();
    await page.getByLabel("PR 주소").fill(mock.prUrl);
    await page.getByRole("button", { name: "PR 열기" }).click();
    await expect(page.getByTestId("pr-chip")).toHaveText("#1 쿠폰 할인", { timeout: 60_000 });
    await page.getByTestId("step-row").first().waitFor();
    // 진입점(바뀌지 않은 파일)은 PR diff 밖, placeOrder 선언 줄은 diff 안
    await addNote(page, "진입점 확인");
    await page.keyboard.press("j");
    await addNote(page, "재고 차감이 결제 앞으로 왔습니다");
    await page.getByTestId("notes-toggle").click();
    await page.getByTestId("post-open").click();
    const dialog = page.getByTestId("post-dialog");
    await expect(dialog.getByTestId("post-plan")).toHaveCount(2);
    await expect(dialog.getByTestId("post-plan").filter({ hasText: "OrderService.java:17" })).toContainText("줄 코멘트");
    await expect(dialog.getByTestId("post-plan").filter({ hasText: "OrderController.java" })).toContainText("일반 코멘트");
    await shot(app, "17-post-preview");
    // 확인하기 전에는 아무것도 올라가지 않는다
    expect(mock.posted).toHaveLength(0);
    await dialog.getByRole("button", { name: /게시 \(2\)/ }).click();
    await expect(dialog.getByTestId("post-done")).toHaveText("2개를 올렸습니다.");
    expect(mock.posted.map((p) => p.kind).sort()).toEqual(["general", "line"]);
    expect(mock.posted.find((p) => p.kind === "general")!.body).toContain("src/main/java/shop/order/OrderController.java:");
    expect(mock.posted.find((p) => p.kind === "line")).toMatchObject({ path: "src/main/java/shop/order/OrderService.java", line: 17 });
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(page.getByTestId("note-posted")).toHaveCount(2);
    await expect(page.getByTestId("post-open")).toHaveCount(0);
  } finally {
    await app.close();
    await mock.close();
  }
});
