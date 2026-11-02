import { describe, expect, it } from "vitest";
import { annotationPayload, NoteReader, sourceWindow, type NoteSource } from "../src/annotations.js";

const source: NoteSource = { id: "head", path: "Order.java", sha: "abc", firstLine: 10, text: "class Order {\n  return save();\n}", context: "class Order" };
describe("가상 주석", () => {
  it("전송 코드에 실제 줄과 소스 식별자를 붙인다", () => {
    const p = annotationPayload([source], []);
    expect(p.messages[0]!.content).toContain("CALLPATH_CODE_NOTES_V2");
    expect(p.messages[0]!.content).toContain("의미 단위");
    expect(p.messages[0]!.content).not.toContain("의미 있는 각 코드 줄");
    expect(p.messages[1]!.content).toContain("10: class Order {");
    expect(p.messages[1]!.content).toContain('"id":"head"');
  });
  it("조각 사이에서 갈린 JSON 줄은 완성된 뒤에만 표시한다", () => {
    const r = new NoteReader([source], []);
    expect(r.push('{"source":"head","line":11,')).toEqual([]);
    expect(r.push('"endLine":12,"kind":"block","text":"저장을 요청합니다"}\n')).toEqual([{ source: "head", line: 11, endLine: 12, kind: "block", text: "저장을 요청합니다" }]);
    expect(r.finish()).toHaveLength(1);
  });
  it.each([
    '{"source":"base","line":11,"endLine":12,"kind":"block","text":"다른 시점"}',
    '{"source":"head","line":99,"endLine":99,"kind":"block","text":"없는 줄"}',
    '{"step":2,"text":"없는 단계"}',
    '{"source":"head","line":11,"endLine":12,"kind":"block","text":""}',
    '{"source":"head","line":11,"kind":"line","text":"이전 형식"}',
  ])("요청 범위 밖 응답은 실패로 처리한다: %s", text => {
    const r = new NoteReader([source], []);
    expect(() => { r.push(text); r.finish(); }).toThrow();
  });
  it("지도는 확인된 단계 번호만 받는다", () => {
    const r = new NoteReader([], [{ n: 1, label: "Order.place", detail: "진입점" }]);
    r.push('{"step":1,"text":"주문을 받습니다"}\n');
    expect(r.finish()).toEqual([{ step: 1, text: "주문을 받습니다" }]);
  });
  it.each([9, 13, 10.5])("구간 끝도 실제 코드 범위를 벗어나면 거절한다: %s", endLine => {
    const r = new NoteReader([source], []);
    expect(() => r.push(JSON.stringify({ source: "head", line: 10, endLine, kind: "block", text: "설명" }) + "\n")).toThrow();
  });
  it("겹치는 본문 구간은 거절하고 클래스 요약과 본문은 함께 받는다", () => {
    const r = new NoteReader([source], []);
    r.push('{"source":"head","line":10,"endLine":12,"kind":"class","text":"주문 처리"}\n');
    r.push('{"source":"head","line":10,"endLine":11,"kind":"block","text":"주문 검증"}\n');
    expect(() => r.push('{"source":"head","line":11,"endLine":12,"kind":"block","text":"중복 설명"}\n')).toThrow();
  });
  it("모든 줄마다 붙인 설명은 구간 설명으로 받지 않는다", () => {
    const r = new NoteReader([{ ...source, text: Array.from({ length: 12 }, () => 'call();').join('\n') }], []);
    for (let line = 10; line < 14; line++) r.push(JSON.stringify({ source: 'head', line, endLine: line, kind: 'block', text: '호출' }) + '\n');
    expect(() => r.push('{"source":"head","line":14,"endLine":14,"kind":"block","text":"또 호출"}\n')).toThrow(/잘게/);
  });
  it("같은 구간이 스트림에 반복돼도 겹침 오류나 중복 설명을 만들지 않는다", () => {
    const r = new NoteReader([source], []);
    const note = '{"source":"head","line":10,"endLine":12,"kind":"block","text":"주문 처리"}\n';
    r.push(note); expect(r.push(note)).toEqual([]); expect(r.finish()).toHaveLength(1);
  });
  it("큰 파일은 줄 중간을 자르지 않고 현재 범위를 제한한다", () => {
    const w = sourceWindow("aaaa\nbbbb\ncccc", 2, 3, 10);
    expect(w).toEqual({ firstLine: 2, text: "bbbb\ncccc", lastLine: 3, truncated: false });
    expect(sourceWindow("aaaa\nbbbb\ncccc", 1, 3, 8)).toEqual({ firstLine: 1, text: "aaaa", lastLine: 1, truncated: true });
    expect(() => sourceWindow("x".repeat(20), 1, 1, 10)).toThrow();
  });
});
