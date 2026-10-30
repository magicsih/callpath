import { useEffect, useRef } from "react";
import { EDITOR_OPTIONS, monaco } from "../monaco";
import type { CodeMark } from "../guideNav";

interface Props {
  text: string;
  language: string;
  /** text의 첫 줄이 파일의 몇 번째 줄인지(1부터) */
  firstLine: number;
  /** 처음 보여 줄 줄(파일 기준, 1부터) */
  reveal: number | null;
  /** 옅게 칠할 범위(파일 기준, 1부터, 끝 포함) */
  highlight: { from: number; to: number } | null;
  /** 줄 끝에 붙일 표시(투어의 이어지는 단계, 접은 메서드) */
  marks: CodeMark[];
  label: string;
}

/** 둘러보기의 읽기 전용 코드 보기. 리뷰 화면의 한 열 보기와 같은 편집기 설정을 쓴다 */
export function CodeView({ text, language, firstLine, reveal, highlight, marks, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const tint = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const markDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const e = monaco.editor.create(host.current!, { ...EDITOR_OPTIONS, model: monaco.editor.createModel("", "plaintext") });
    editor.current = e;
    tint.current = e.createDecorationsCollection();
    markDecos.current = e.createDecorationsCollection();
    return () => {
      const model = e.getModel();
      e.dispose();
      model?.dispose();
    };
  }, []);

  useEffect(() => {
    const e = editor.current!;
    const model = e.getModel()!;
    monaco.editor.setModelLanguage(model, language);
    model.setValue(text);
    e.updateOptions({ lineNumbers: (n: number) => String(n + firstLine - 1), ariaLabel: label });
    const local = (line: number) => line - firstLine + 1;
    tint.current!.set(
      highlight ? [{ range: new monaco.Range(local(highlight.from), 1, local(highlight.to), 1), options: { isWholeLine: true, className: "tour-range" } }] : [],
    );
    // 줄 끝에 글자를 붙이는 장식과 줄을 칠하는 장식을 나눈다(한 장식에 함께 두면 글자가 붙지 않는다)
    const lines = model.getLineCount();
    markDecos.current!.set(
      marks
        .filter((m) => local(m.line) >= 1 && local(m.line) <= lines)
        .flatMap((m) => {
          const ln = local(m.line);
          const end = model.getLineMaxColumn(ln);
          const text = { range: new monaco.Range(ln, end, ln, end), options: { after: { content: `  ${m.text}`, inlineClassName: `tour-mark ${m.kind}` }, showIfCollapsed: true } };
          return m.kind === "next" ? [text, { range: new monaco.Range(ln, 1, ln, 1), options: { isWholeLine: true, className: "tour-line-next" } }] : [text];
        }),
    );
    if (reveal !== null) {
      e.revealLineNearTop(local(reveal));
      e.setPosition({ lineNumber: local(reveal), column: 1 });
    } else e.setScrollTop(0);
  }, [text, language, firstLine, reveal, highlight?.from, highlight?.to, marks, label]);

  return <div className="diff" ref={host} data-testid="code-view" />;
}
