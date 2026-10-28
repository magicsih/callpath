import { describe, expect, it } from "vitest";
import { buildCallGraph, methodId } from "../src/graph/callGraph.js";
import { indexFile } from "../src/index/symbols.js";
import { parse } from "../src/index/parser.js";
import type { Language } from "../src/types.js";

async function graphOf(files: Record<string, string>) {
  const idx = [];
  for (const [path, text] of Object.entries(files)) {
    const lang: Language = path.endsWith(".kt") ? "kotlin" : "java";
    idx.push(indexFile(path, lang, await parse(lang, text)));
  }
  const g = buildCallGraph(idx);
  const find = (qn: string) => [...g.methods.values()].find((m) => m.qualifiedName === qn)!;
  const callees = (qn: string) => g.outgoing(methodId(find(qn))).map((e) => `${g.methods.get(e.callee)!.qualifiedName}:${e.confidence}`);
  return { g, callees };
}

describe("1계층 호출 그래프", () => {
  it("필드 타입으로 같은 이름 메서드 중 맞는 클래스를 고른다", async () => {
    const { callees } = await graphOf({
      "A.java": "package p;\nclass A {\n  private final B b;\n  void run() { b.save(); }\n}\n",
      "B.java": "package p;\nclass B {\n  void save() {}\n}\n",
      "C.java": "package p;\nclass C {\n  void save() {}\n}\n",
    });
    expect(callees("p.A.run")).toEqual(["p.B.save:medium"]);
  });

  it("인터페이스 수신자는 구현 클래스로 잇고 신뢰도를 낮춘다", async () => {
    const { callees } = await graphOf({
      "A.java": "package p;\nclass A {\n  private final Repo repo;\n  void run() { repo.save(); }\n}\n",
      "Repo.java": "package p;\ninterface Repo {\n  void save();\n}\n",
      "Jpa.java": "package p;\nclass Jpa implements Repo {\n  public void save() { }\n}\n",
      "Mem.java": "package p;\nclass Mem implements Repo {\n  public void save() { }\n}\n",
    });
    expect(callees("p.A.run").sort()).toEqual(["p.Jpa.save:low", "p.Mem.save:low"]);
  });

  it("저장소 밖 타입의 메서드는 잇지 않는다", async () => {
    const { callees } = await graphOf({
      "A.java": "package p;\nimport java.util.List;\nclass A {\n  void run(List<String> xs) { xs.add(\"a\"); }\n}\n",
      "B.java": "package p;\nclass B {\n  void add(String s) {}\n}\n",
    });
    expect(callees("p.A.run")).toEqual([]);
  });

  it("수신자 타입을 모르면 이름과 인자 수로 잇고, 후보가 여럿이면 low", async () => {
    const { callees } = await graphOf({
      "A.java": "package p;\nclass A {\n  void run() { make().save(1); }\n  Object make() { return null; }\n}\n",
      "B.java": "package p;\nclass B {\n  void save(int x) {}\n}\n",
      "C.java": "package p;\nclass C {\n  void save(int x) {}\n  void save() {}\n}\n",
    });
    expect(callees("p.A.run").sort()).toEqual(["p.A.make:medium", "p.B.save:low", "p.C.save:low"]);
  });

  it("Kotlin: 생성자 매개변수 프로퍼티와 지역 변수 타입 추론", async () => {
    const { callees } = await graphOf({
      "A.kt": "package p\nclass A(private val b: B) {\n  fun run() {\n    b.save()\n    val c = C()\n    c.save()\n  }\n}\n",
      "B.kt": "package p\nclass B {\n  fun save() {}\n}\n",
      "C.kt": "package p\nclass C {\n  fun save() {}\n}\n",
    });
    expect(callees("p.A.run")).toEqual(["p.B.save:medium", "p.C.save:medium"]);
  });

  it("상위 클래스에 정의된 메서드를 따라간다", async () => {
    const { callees } = await graphOf({
      "A.java": "package p;\nclass A {\n  private final Child c;\n  void run() { c.base(); }\n}\n",
      "Parent.java": "package p;\nclass Parent {\n  void base() {}\n}\n",
      "Child.java": "package p;\nclass Child extends Parent {\n}\n",
    });
    expect(callees("p.A.run")).toEqual(["p.Parent.base:medium"]);
  });

  it("Kotest 스펙 람다 안의 호출을 테스트 본문으로 잡는다", async () => {
    const { callees } = await graphOf({
      "OrderSpec.kt": "package p\nclass OrderSpec : StringSpec({\n  \"places\" {\n    val s = Svc()\n    s.place()\n  }\n})\n",
      "Svc.kt": "package p\nclass Svc {\n  fun place() {}\n}\n",
    });
    expect(callees("p.OrderSpec.<spec>")).toEqual(["p.Svc.place:medium"]);
  });
});

describe("인자 안 호출 표시", () => {
  it("decrease(request.items())의 items는 nested, 람다 본문 안의 문장 호출은 바깥 호출", async () => {
    const lang = "java" as const;
    const tree = await parse(lang, "class A {\n  void run(R r) {\n    decrease(r.items());\n    list.forEach(x -> { save(x); });\n  }\n}\n");
    const m = indexFile("A.java", lang, tree).methods[0]!;
    expect(m.calls.map((c) => `${c.name}:${c.nested}`)).toEqual(["decrease:false", "items:true", "forEach:false", "save:false"]);
  });
});
