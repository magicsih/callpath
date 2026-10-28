import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_DIR = resolve(__dirname, "..");
const FIXTURES = resolve(__dirname, "../../../fixtures");
export const EVIDENCE = resolve(__dirname, "../test-results/evidence");

/** 쿠폰 표본으로 main(base)과 feature/coupon(head) 두 브랜치가 있는 임시 저장소를 만든다 */
export function makeFixtureRepo(lang: "java" | "kotlin" = "java"): string {
  const dir = mkdtempSync(join(tmpdir(), `callpath-e2e-${lang}-`));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=e2e@callpath.test", "-c", "user.name=e2e", ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  cpSync(join(FIXTURES, lang, "base"), dir, { recursive: true });
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "feature/coupon");
  rmSync(join(dir, "src"), { recursive: true });
  cpSync(join(FIXTURES, lang, "head"), dir, { recursive: true });
  git("add", "-A");
  git("commit", "-qm", "쿠폰 할인");
  return dir;
}

export function makeUserData(): string {
  return mkdtempSync(join(tmpdir(), "callpath-e2e-data-"));
}

export async function launch(userData: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [APP_DIR, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, CALLPATH_USER_DATA: userData, ...env } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

/** 확대 상태에서도 창 전체가 찍히도록 Electron의 capturePage로 찍는다 */
export async function shot(app: ElectronApplication, name: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  const path = join(EVIDENCE, `${name}.png`);
  // Linux xvfb에서는 창을 띄운 직후 capturePage가 UnknownVizError로 실패할 때가 있어 몇 번 다시 시도한다
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString("base64"));
      writeFileSync(path, Buffer.from(b64, "base64"));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  // 증거 캡처 실패가 기능 판정을 바꾸지 않도록 일반 스크린샷으로 대신한다
  await (await app.firstWindow()).screenshot({ path });
}

/** 시작 화면에서 경로를 입력해 열고 기본 비교로 분석까지 간다 */
export async function openAndAnalyze(page: Page, repo: string): Promise<void> {
  await page.getByLabel("저장소 경로").fill(repo);
  await page.getByLabel("저장소 경로").press("Enter");
  await page.getByRole("button", { name: "흐름 분석" }).click();
  await page.getByTestId("step-row").first().waitFor();
}
