import { describe, expect, it } from "vitest";
import { annotationPayload, NoteReader, sourceWindow, type NoteSource } from "../src/annotations.js";

const source: NoteSource = { id: "head", path: "Order.java", sha: "abc", firstLine: 10, text: "class Order {\n  return save();\n}", context: "class Order" };
describe("가상 주석", () => {
  it("전송 코드에 실제 줄과 소스 식별자를 붙인다", () => {
    const p = annotationPayload([source], []);
    expect(p.messages[0]!.content).toContain("CALLPATH_CODE_NOTES_V1");
    expect(p.messages[1]!.content).toContain("10: class Order {");
    expect(p.messages[1]!.content).toContain('"id":"head"');
  });
  it("조각 사이에서 갈린 JSON 줄은 완성된 뒤에만 표시한다", () => {
    const r = new NoteReader([source], []);
    expect(r.push('{"source":"head","line":11,')).toEqual([]);
    expect(r.push('"kind":"line","text":"저장을 요청합니다"}\n')).toEqual([{ source: "head", line: 11, kind: "line", text: "저장을 요청합니다" }]);
    expect(r.finish()).toHaveLength(1);
  });
  it.each([
    '{"source":"base","line":11,"kind":"line","text":"다른 시점"}',
    '{"source":"head","line":99,"kind":"line","text":"없는 줄"}',
    '{"step":2,"text":"없는 단계"}',
    '{"source":"head","line":11,"kind":"line","text":""}',
  ])("요청 범위 밖 응답은 실패로 처리한다: %s", text => {
    const r = new NoteReader([source], []);
    expect(() => { r.push(text); r.finish(); }).toThrow();
  });
  it("지도는 확인된 단계 번호만 받는다", () => {
    const r = new NoteReader([], [{ n: 1, label: "Order.place", detail: "진입점" }]);
    r.push('{"step":1,"text":"주문을 받습니다"}\n');
    expect(r.finish()).toEqual([{ step: 1, text: "주문을 받습니다" }]);
  });
  it("큰 파일은 줄 중간을 자르지 않고 현재 범위를 제한한다", () => {
    const w = sourceWindow("aaaa\nbbbb\ncccc", 2, 3, 10);
    expect(w).toEqual({ firstLine: 2, text: "bbbb\ncccc", lastLine: 3, truncated: false });
    expect(sourceWindow("aaaa\nbbbb\ncccc", 1, 3, 8)).toEqual({ firstLine: 1, text: "aaaa", lastLine: 1, truncated: true });
    expect(() => sourceWindow("x".repeat(20), 1, 1, 10)).toThrow();
  });
});
