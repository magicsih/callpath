import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { launch, makeFixtureRepo, makeShopRepo, makeUserData, openAndAnalyze, shot } from "./harness";

const repo = makeShopRepo();
for (const [path,text] of Object.entries({
  "src/main/kotlin/nav/AliasedHolder.kt":"package nav\nimport com.example.shop.payment.PaymentClient as Pay\nclass AliasedHolder(val client: Pay) {\n    class Inner\n}\n",
  "src/main/java/one/Twins.java":"package one; public class Twins {}",
  "src/main/kotlin/two/Twins.kt":"package two\ndata class Twins(val n: Int)",
})) { const file=join(repo,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text); }
execFileSync("git",["-C",repo,"-c","user.email=e2e@callpath.test","-c","user.name=e2e","add","-A"]);
execFileSync("git",["-C",repo,"-c","user.email=e2e@callpath.test","-c","user.name=e2e","commit","-qm","탐색 표본"]);
const compare = makeFixtureRepo();
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const picker = (page: Page) => page.locator(".class-picker");
const reader = (page: Page) => page.getByTestId("navigation-reader");
async function guide(page: Page, repoPath = repo) {
  await page.getByLabel("저장소 경로").fill(repoPath);await page.getByLabel("저장소 경로").press("Enter");
  await expect(page.getByLabel("둘러볼 브랜치나 커밋")).toHaveValue("main");
  await page.getByRole("button",{name:"둘러보기",exact:true}).click();await expect(page.getByTestId("guide-map")).toBeVisible();
}
async function search(page: Page, query: string) {
  await page.keyboard.press(`${modifier}+o`);await expect(picker(page)).toBeVisible();
  await page.getByLabel("클래스 이름, 패키지 또는 경로").fill(query);
}
async function choose(page: Page, name: string) {
  const option = picker(page).getByRole("option").filter({has:page.locator("strong").filter({hasText:new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}$`)})});
  await expect(option).toHaveCount(1);await option.click();
  await expect(reader(page).getByRole("heading",{level:2})).toHaveText(name);
  await expect(reader(page).getByTestId("code-view").locator(".view-lines")).not.toBeEmpty();
}

test("클래스 탐색: 검색, F12, 구현체 선택과 원래 위치 복원",async()=>{
  const {app,page}=await launch(makeUserData());const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  try {
    await guide(page);await search(page,"OrderService");await shot(app,"navigation-01-search");await choose(page,"OrderService");
    const code=reader(page).getByTestId("code-view");
    await code.locator(".view-lines").getByText("PaymentClient payment;",{exact:false}).first().click();
    const previousLine=await code.locator(".active-line-number").innerText();
    await page.keyboard.press("F12");await expect(reader(page).getByRole("heading",{level:2})).toHaveText("PaymentClient");
    await reader(page).getByRole("button",{name:"구현체로 이동",exact:true}).click();await expect(picker(page).getByRole("option")).toHaveCount(2);await shot(app,"navigation-02-implementations");
    await page.keyboard.press("Escape");await expect(picker(page)).not.toBeVisible();await expect(reader(page).getByRole("heading",{level:2})).toHaveText("PaymentClient");
    await reader(page).getByRole("button",{name:"구현체로 이동",exact:true}).click();await choose(page,"CardPaymentClient");await shot(app,"navigation-03-code");
    await reader(page).getByRole("button",{name:"이전 코드 위치",exact:true}).click();await expect(reader(page).getByRole("heading",{level:2})).toHaveText("PaymentClient");
    await reader(page).getByRole("button",{name:"이전 코드 위치",exact:true}).click();await expect(reader(page).getByRole("heading",{level:2})).toHaveText("OrderService");
    await expect(reader(page).getByTestId("code-view").locator(".active-line-number")).toHaveText(previousLine);
    await reader(page).getByRole("button",{name:"원래 보기로",exact:true}).click();await expect(reader(page)).not.toBeVisible();await expect(page.getByTestId("guide-map")).toBeVisible();
    await page.keyboard.press("Alt+ArrowRight");await expect(reader(page).getByRole("heading",{level:2})).toHaveText("OrderService");
    expect(execFileSync("git",["-C",repo,"status","--porcelain"],{encoding:"utf8"})).toBe("");expect(errors).toEqual([]);
  } finally {await app.close();}
});

test("클래스 탐색: Kotlin 별칭, 중첩과 테스트, 같은 이름과 빈 검색",async()=>{
  const {app,page}=await launch(makeUserData());
  try {
    await guide(page);await search(page,"AliasedHolder");await choose(page,"AliasedHolder");
    const token=reader(page).getByTestId("code-view").locator(".view-line").filter({hasText:"val client"}).getByText("Pay",{exact:true});
    await token.click({modifiers:[modifier]});await expect(reader(page).getByRole("heading",{level:2})).toHaveText("PaymentClient");
    await search(page,"AliasedHolder.Inner");await choose(page,"AliasedHolder.Inner");
    await search(page,"OrderServiceTest");await expect(picker(page).getByRole("option")).toContainText("테스트");await choose(page,"OrderServiceTest");
    await search(page,"Twins");await expect(picker(page).getByRole("option")).toHaveCount(2);await picker(page).getByRole("option").filter({hasText:"two/Twins.kt"}).click();await expect(reader(page).locator(".path")).toContainText("two/Twins.kt");
    await search(page,"NoSuchClass");await expect(picker(page).getByText("일치하는 클래스가 없습니다")).toBeVisible();await page.keyboard.press("Escape");await expect(reader(page).locator(".path")).toContainText("two/Twins.kt");
  } finally {await app.close();}
});

test("클래스 탐색: 비교의 이전과 이후 시점, 바뀌지 않은 클래스와 원래 diff 유지",async()=>{
  const {app,page}=await launch(makeUserData());
  try {
    await openAndAnalyze(page,compare);const originalTitle=await page.getByTestId("detail-title").innerText();
    await search(page,"CouponCalculator");await page.getByLabel("검색할 코드 시점").selectOption("base");await expect(picker(page).getByText("일치하는 클래스가 없습니다")).toBeVisible();
    await page.getByLabel("검색할 코드 시점").selectOption("head");await choose(page,"CouponCalculator");await expect(reader(page).locator(".refs")).toContainText("이후 코드@");
    await search(page,"OrderService");await page.getByLabel("검색할 코드 시점").selectOption("base");await choose(page,"OrderService");await expect(reader(page).locator(".refs")).toContainText("이전 코드@");await expect(reader(page).locator(".view-lines")).not.toContainText("couponCalculator");
    await search(page,"OrderService");await page.getByLabel("검색할 코드 시점").selectOption("head");await choose(page,"OrderService");await expect(reader(page).locator(".view-lines")).toContainText("couponCalculator");
    await reader(page).getByRole("button",{name:"원래 보기로",exact:true}).click();await expect(page.getByTestId("detail-title")).toHaveText(originalTitle);await expect(page.getByTestId("diff")).toBeVisible();
  } finally {await app.close();}
});

test("클래스 탐색: 작은 창과 확대의 검색, 키보드 취소",async()=>{
  const {app,page}=await launch(makeUserData());
  try {
    await guide(page);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0]!;w.setContentSize(900,600);w.webContents.setZoomFactor(1.5);});
    await search(page,"Payment");await expect(picker(page).getByRole("option").first()).toBeVisible();
    const box=await picker(page).boundingBox(),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);
    await shot(app,"navigation-04-small-zoom");await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");await expect(reader(page)).toBeVisible();await expect(reader(page).getByTestId("code-view")).toBeVisible();
    await search(page,"NoSuchClass");await expect(picker(page).getByText("일치하는 클래스가 없습니다")).toBeVisible();await page.keyboard.press("Escape");await expect(picker(page)).not.toBeVisible();
  } finally {await app.close();}
});

test("클래스 탐색: 100개를 넘는 결과와 선택 항목의 키보드 이동",async()=>{
  const many=makeShopRepo(),file=join(many,"src/main/java/search/Many.java");mkdirSync(dirname(file),{recursive:true});
  writeFileSync(file,"package search;\n"+Array.from({length:105},(_,i)=>`class SearchCase${String(i).padStart(3,"0")} {}`).join("\n"));
  execFileSync("git",["-C",many,"-c","user.email=e2e@callpath.test","-c","user.name=e2e","add","-A"]);execFileSync("git",["-C",many,"-c","user.email=e2e@callpath.test","-c","user.name=e2e","commit","-qm","검색 목록 표본"]);
  const {app,page}=await launch(makeUserData());
  try {
    await guide(page,many);await page.getByRole("button",{name:"클래스 검색"}).click();await page.getByLabel("클래스 이름, 패키지 또는 경로").fill("SearchCase");await expect(picker(page).getByRole("option")).toHaveCount(100);await expect(picker(page).locator("footer")).toContainText("105개, 100개 표시");
    await picker(page).getByRole("button",{name:"100개 더 보기",exact:true}).click();await expect(picker(page).getByRole("option")).toHaveCount(105);
    await page.getByLabel("클래스 이름, 패키지 또는 경로").focus();await page.keyboard.press("Tab");await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");await expect(reader(page).getByRole("heading",{level:2})).toHaveText("SearchCase001");
    await reader(page).getByRole("button",{name:"원래 보기로",exact:true}).click();await expect(page.getByRole("button",{name:"클래스 검색"})).toBeFocused();
    await page.getByRole("button",{name:"다음 코드 위치",exact:true}).click();await expect(reader(page).getByRole("heading",{level:2})).toHaveText("SearchCase001");
  } finally {await app.close();}
});
