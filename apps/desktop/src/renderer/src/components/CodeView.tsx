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
  /** 줄 번호 옆 띠로 보일 범위(파일 기준, 1부터, 끝 포함). 글자 대비를 지키려고 배경은 칠하지 않는다 */
  highlight: { from: number; to: number } | null;
  /** 줄 끝에 붙일 표시(투어의 이어지는 단계, 접은 메서드) */
  marks: CodeMark[];
  label: string;
  /** 줄 끝 표시를 눌렀을 때. 그 표시의 단계 번호 */
  onMarkClick?: (to: number) => void;
}

/** 둘러보기의 읽기 전용 코드 보기. 리뷰 화면의 한 열 보기와 같은 편집기 설정을 쓴다 */
export function CodeView({ text, language, firstLine, reveal, highlight, marks, label, onMarkClick }: Props) {
  const clickRef = useRef(onMarkClick);
  clickRef.current = onMarkClick;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const tint = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const markDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const e = monaco.editor.create(host.current!, { ...EDITOR_OPTIONS, model: monaco.editor.createModel("", "plaintext") });
    editor.current = e;
    tint.current = e.createDecorationsCollection();
    markDecos.current = e.createDecorationsCollection();
    // 줄 끝에 붙인 글자(→ n단계)를 누르면 그 단계로 간다. 표시마다 단계 번호를 달아 두어 한 줄에 둘이어도 누른 것으로 간다
    const sub = e.onMouseDown((ev) => {
      if (ev.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
      // 공개 타입에는 없지만 줄 끝 글자를 누르면 detail에 그 글자의 장식 옵션이 담긴다
      const detail = ev.target.detail as { injectedText?: { options: { attachedData?: unknown } } | null };
      const data = detail.injectedText?.options.attachedData as { to?: number } | undefined;
      if (data?.to) clickRef.current?.(data.to);
    });
    return () => {
      sub.dispose();
      const model = e.getModel();
      e.dispose();
      model?.dispose();
    };
  }, []);

  // 글이 바뀔 때만 내용을 바꾸고 스크롤을 정한다. 다른 이유로 다시 그려질 때 읽던 위치가 처음으로 튀지 않게 한다
  useEffect(() => {
    const e = editor.current!;
    const model = e.getModel()!;
    monaco.editor.setModelLanguage(model, language);
    if (model.getValue() !== text) model.setValue(text);
    e.updateOptions({ lineNumbers: (n: number) => String(n + firstLine - 1), ariaLabel: label });
    if (reveal !== null) {
      e.revealLineNearTop(reveal - firstLine + 1);
      e.setPosition({ lineNumber: reveal - firstLine + 1, column: 1 });
    } else e.setScrollTop(0);
  }, [text, language, firstLine, reveal, label]);

  useEffect(() => {
    const e = editor.current!;
    const model = e.getModel()!;
    const local = (line: number) => line - firstLine + 1;
    tint.current!.set(
      highlight ? [{ range: new monaco.Range(local(highlight.from), 1, local(highlight.to), 1), options: { isWholeLine: true, linesDecorationsClassName: "range-bar" } }] : [],
    );
    // 줄 끝에 글자를 붙이는 장식과 줄을 칠하는 장식을 나눈다(한 장식에 함께 두면 글자가 붙지 않는다)
    const lines = model.getLineCount();
    const shown = marks.filter((m) => local(m.line) >= 1 && local(m.line) <= lines);
    markDecos.current!.set([
      ...shown.map((m) => {
        const ln = local(m.line);
        const end = model.getLineMaxColumn(ln);
        return {
          range: new monaco.Range(ln, end, ln, end),
          options: { after: { content: `  ${m.text}`, inlineClassName: `tour-mark ${m.kind}`, attachedData: { to: m.to } }, showIfCollapsed: true },
        };
      }),
      ...[...new Set(shown.filter((m) => m.kind === "next").map((m) => local(m.line)))].map((ln) => ({
        range: new monaco.Range(ln, 1, ln, 1),
        options: { isWholeLine: true, className: "tour-line-next" },
      })),
    ]);
  }, [text, firstLine, highlight?.from, highlight?.to, marks]);

  return <div className="diff" ref={host} data-testid="code-view" />;
}
