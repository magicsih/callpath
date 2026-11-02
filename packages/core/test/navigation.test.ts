import { describe, expect, it } from "vitest";
import { createNavigation } from "../src/navigation.js";
import type { FileSource } from "../src/source/fileSource.js";

function source(files: Record<string, string>): FileSource {
  return { label: "fixture", listFiles: async () => Object.keys(files), read: async p => files[p]!, readMany: async paths => new Map(paths.map(p => [p, files[p]!])) };
}
const names = (r: { items: { qualifiedName: string }[] }) => r.items.map(c => c.qualifiedName);
function at(text: string, token: string, occurrence = 0) {
  let offset = -1;
  for (let n = 0; n <= occurrence; n++) offset = text.indexOf(token, offset + 1);
  const before = text.slice(0, offset);
  return { line: before.split("\n").length - 1, column: offset - before.lastIndexOf("\n") - 1 };
}

describe("클래스 검색과 타입 탐색", () => {
  it("동명 타입, 테스트와 중첩 클래스를 포함하고 생성 코드는 제외한다", async () => {
    const nav = await createNavigation(source({
      "src/p/Foo.java": "package p; class Foo { class Inner {} }",
      "src/q/Foo.kt": "package q\ndata class Foo(val n: Int)",
      "src/test/p/FooTest.java": "package p; class FooTest {}",
      "build/Foo.java": "class GeneratedFoo {}",
    }));
    expect(names(nav.query({ kind: "search", query: "Foo" }))).toEqual(["p.Foo", "q.Foo", "p.Foo.Inner", "p.FooTest"]);
    expect(nav.query({ kind: "search", query: "src/test", limit: 1 })).toMatchObject({ total: 1, items: [{ test: true }] });
    expect(names(nav.query({ kind: "search", query: "p.Foo.Inner" }))).toEqual(["p.Foo.Inner"]);
    expect(nav.query({ kind: "search", query: "", limit: 2 })).toMatchObject({ total: 4, items: [{}, {}] });
  });
  it("같은 패키지, 명시 import, 전체 이름과 Kotlin 별칭을 구별한다", async () => {
    const java = "package p; import q.Client; class Use { Client c; p.Client local; }";
    const kotlin = "package p\nimport q.Client as Pay\nclass UseK(val client: Pay)";
    const nav = await createNavigation(source({ "p/Client.java": "package p; interface Client {}", "q/Client.java": "package q; interface Client {}", "p/Use.java": java, "p/UseK.kt": kotlin }));
    expect(names(nav.query({ kind: "definition", path: "p/Use.java", position: at(java, "Client c") }))).toEqual(["q.Client"]);
    expect(names(nav.query({ kind: "definition", path: "p/Use.java", position: at(java, "Client local") }))).toEqual(["p.Client"]);
    expect(names(nav.query({ kind: "definition", path: "p/UseK.kt", position: at(kotlin, "Pay)") }))).toEqual(["q.Client"]);
  });
  it("주석, 문자열과 외부 타입은 같은 이름의 저장소 클래스로 바꾸지 않는다", async () => {
    const code = 'package p; import external.Client; class Use { Client c; String s = "Client"; /* Client */ }';
    const nav = await createNavigation(source({ "q/Client.java": "package q; interface Client {}", "p/Use.java": code }));
    for (const position of [at(code,"Client c"), at(code,'Client"'), at(code,"Client */")]) expect(nav.query({ kind: "definition", path: "p/Use.java", position }).items).toEqual([]);
  });
  it("모호한 wildcard import는 후보를 모두 돌려준다", async () => {
    const code = "package app; import a.*; import b.*; class Use { Client c; }";
    const nav = await createNavigation(source({ "a/C.java": "package a; interface Client {}", "b/C.java": "package b; interface Client {}", "app/Use.java": code }));
    expect(names(nav.query({ kind: "definition", path: "app/Use.java", position: at(code,"Client c") }))).toEqual(["a.Client", "b.Client"]);
  });
  it("중간 추상 타입과 인터페이스를 거친 구현도 찾고 선언의 실제 이름 위치를 준다", async () => {
    const nav = await createNavigation(source({
      "p/API.java": "package p; public interface API {}",
      "p/Base.java": "package p; public abstract class Base implements API {}",
      "p/Leaf.java": "package p;\n@Deprecated\npublic class Leaf extends Base {}",
      "p/KLeaf.kt": "package p\nclass KLeaf: Base()",
      "q/API.java": "package q; interface API {}",
      "q/Other.java": "package q; class Other implements API {}",
    }));
    const api=nav.query({ kind:"search", query:"p.API" }).items[0]!;
    const impl=nav.query({kind:"implementors",id:api.id});
    expect(names(impl)).toEqual(["p.Base", "p.KLeaf", "p.Leaf"]);
    expect(impl.items.find(c=>c.name==="Base")!.abstract).toBe(true);
    const leaf=impl.items.find(c=>c.name==="Leaf")!;
    expect(leaf.namePos).toEqual({line:2,column:13});
    expect(names(nav.query({kind:"parents",id:leaf.id}))).toEqual(["p.Base"]);
  });
  it("같은 이름이라도 다른 import의 상속 관계를 섞지 않는다", async () => {
    const code="package app; import external.API; class Leaf implements API {}";
    const nav=await createNavigation(source({"p/API.java":"package p; interface API {}","app/L.java":code}));
    const api=nav.query({kind:"search",query:"p.API"}).items[0]!;
    expect(nav.query({kind:"implementors",id:api.id}).items).toEqual([]);
  });
  it("디렉터리 범위와 빈 결과, 순환 상속을 처리한다", async () => {
    const nav=await createNavigation(source({"api/A.java":"class A extends B {}","api/B.java":"class B extends A {}","other/C.java":"class C {}"}),"api");
    const a=nav.query({kind:"search",query:"A"}).items.find(c=>c.name==="A")!;
    expect(names(nav.query({kind:"implementors",id:a.id}))).toEqual(["B"]);
    expect(nav.query({kind:"search",query:"C"}).items).toEqual([]);
  });
  it("중첩 타입은 import보다 가깝고 제네릭 타입 매개변수는 동명 클래스로 이동하지 않는다",async()=>{
    const code="package p; import q.Client; class Outer<T> { class Client {} Client local; T value; }";
    const nav=await createNavigation(source({"p/Outer.java":code,"p/T.java":"package p; class T {}","q/Client.java":"package q; interface Client {}"}));
    expect(names(nav.query({kind:"definition",path:"p/Outer.java",position:at(code,"Client local")}))).toEqual(["p.Outer.Client"]);
    expect(nav.query({kind:"definition",path:"p/Outer.java",position:at(code,"T value")}).items).toEqual([]);
  });
  it("Kotlin companion object와 import 별칭 선언을 찾아간다",async()=>{
    const code="package p\nimport q.Client as Pay\nclass Outer { companion object {} }";
    const nav=await createNavigation(source({"p/Outer.kt":code,"q/Client.kt":"package q\ninterface Client"}));
    expect(names(nav.query({kind:"search",query:"Companion"}))).toEqual(["p.Outer.Companion"]);
    expect(names(nav.query({kind:"definition",path:"p/Outer.kt",position:at(code,"Pay")}))).toEqual(["q.Client"]);
  });
  it("애노테이션과 전체 이름으로 쓴 정적 타입 참조를 찾는다",async()=>{
    const code="package p; @Flag class Use { void run() { q.Client.run(); } }";
    const nav=await createNavigation(source({"p/Use.java":code,"p/Flag.java":"package p; @interface Flag {}","q/Client.java":"package q; class Client { static void run() {} }"}));
    expect(names(nav.query({kind:"definition",path:"p/Use.java",position:at(code,"Flag")}))).toEqual(["p.Flag"]);
    expect(names(nav.query({kind:"definition",path:"p/Use.java",position:at(code,"Client.run")}))).toEqual(["q.Client"]);
  });
  it("유니코드 import와 Kotlin의 역따옴표 타입 이름을 보존한다",async()=>{
    const java="package p; import q.고객; class Use { 고객 client; }";
    const kotlin="package p\nclass `Event Handler` {}\nclass KUse(val handler: `Event Handler`)";
    const nav=await createNavigation(source({"p/Use.java":java,"p/고객.java":"package p; class 고객 {}","q/고객.java":"package q; class 고객 {}","p/KUse.kt":kotlin}));
    expect(names(nav.query({kind:"definition",path:"p/Use.java",position:at(java,"고객 client")}))).toEqual(["q.고객"]);
    expect(names(nav.query({kind:"search",query:"Event Handler"}))).toEqual(["p.Event Handler"]);
    expect(names(nav.query({kind:"definition",path:"p/KUse.kt",position:at(kotlin,"`Event Handler`",1)}))).toEqual(["p.Event Handler"]);
  });
  it("애노테이션 인자 이름을 애노테이션 타입으로 오인하지 않는다",async()=>{
    const code="package p; @Flag(value=Mode.PAID) class Use {}";
    const nav=await createNavigation(source({"p/Use.java":code,"p/Flag.java":"package p; @interface Flag {}","p/Mode.java":"package p; enum Mode { PAID }"}));
    expect(names(nav.query({kind:"definition",path:"p/Use.java",position:at(code,"Mode.PAID")}))).toEqual(["p.Mode"]);
    expect(nav.query({kind:"definition",path:"p/Use.java",position:at(code,"value")}).items).toEqual([]);
  });
});
