import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_DIR = resolve(__dirname, "..");
const FIXTURES = resolve(__dirname, "../../../fixtures");
export const EVIDENCE = resolve(__dirname, "../test-results/evidence");

// 테스트가 만든 임시 저장소와 앱 데이터 폴더는 실행이 끝나면 지운다
const created: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};
process.on("exit", () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** 쿠폰 표본으로 main(base)과 feature/coupon(head) 두 브랜치가 있는 임시 저장소를 만든다 */
export function makeFixtureRepo(lang: "java" | "kotlin" = "java"): string {
  const dir = temp(`callpath-e2e-${lang}-`);
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

/** base 표본 위에 head 쪽 파일 하나만 고친 저장소. 진입점 바로 뒤가 바뀌지 않은 흐름을 만든다 */
export function makeTransitRepo(): string {
  const dir = temp("callpath-e2e-transit-");
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=e2e@callpath.test", "-c", "user.name=e2e", ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  cpSync(join(FIXTURES, "java", "base"), dir, { recursive: true });
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "feature/confirm");
  const file = join(dir, "src/main/java/shop/order/OrderRepository.java");
  writeFileSync(file, readFileSync(file, "utf8").replace("return new OrderResult(request.orderId(), paidAmount);", "OrderResult result = new OrderResult(request.orderId(), paidAmount);\n        audit(result);\n        return result;\n    }\n\n    void audit(OrderResult result) {"));
  git("commit", "-qam", "확정 감사 기록");
  return dir;
}

/** base 표본에서 head 쪽 파일 하나만 고친 저장소 */
export function makeRepoWithHeadEdit(file: string, edit: (text: string) => string): string {
  const dir = temp("callpath-e2e-edit-");
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=e2e@callpath.test", "-c", "user.name=e2e", ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  cpSync(join(FIXTURES, "java", "base"), dir, { recursive: true });
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "feature/edit");
  const path = join(dir, file);
  writeFileSync(path, edit(readFileSync(path, "utf8")));
  git("commit", "-qam", "edit");
  return dir;
}

/** 둘러보기 표본(fixtures/shop)을 main 브랜치 커밋 하나로 둔 저장소 */
export function makeShopRepo(): string {
  const dir = temp("callpath-e2e-shop-");
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=e2e@callpath.test", "-c", "user.name=e2e", ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  cpSync(join(FIXTURES, "shop"), dir, { recursive: true });
  git("add", "-A");
  git("commit", "-qm", "shop");
  return dir;
}

/** 큰 저장소 판정(코드 파일 3,000개 초과)을 볼 합성 저장소. 모듈 api, core */
export function makeLargeRepo(): string {
  const dir = temp("callpath-e2e-large-");
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=e2e@callpath.test", "-c", "user.name=e2e", ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  for (const mod of ["api", "core"]) {
    for (let i = 0; i < 1501; i++) {
      const pkg = `p${Math.floor(i / 100)}`;
      const path = join(dir, mod, "src/main/java/com/example", mod, pkg);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, `C${i}.java`), `package com.example.${mod}.${pkg};\n\npublic class C${i} {\n    public int run(int x) {\n        int y = x + 1;\n        return y * 2;\n    }\n}\n`);
    }
  }
  git("add", "-A");
  git("commit", "-qm", "large");
  return dir;
}

export function makeTempDir(prefix: string): string {
  return temp(prefix);
}

export function makeUserData(): string {
  return temp("callpath-e2e-data-");
}

export async function launch(userData: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    // Linux CI에는 암호 저장소가 없어 basic 저장소로 토큰 저장을 확인한다(화면은 약한 보관을 경고한다)
    args: [APP_DIR, ...(process.platform === "linux" ? ["--no-sandbox", "--password-store=basic"] : [])],
    // 정밀 분석은 기본으로 끈다. JDT LS를 띄우는 시나리오만 켜서 다른 시나리오의 시간과 결과를 일정하게 둔다
    env: { ...process.env, CALLPATH_USER_DATA: userData, CALLPATH_PRECISE: "off", ...env } as Record<string, string>,
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
