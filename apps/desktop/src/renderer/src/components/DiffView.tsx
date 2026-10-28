import { useEffect, useRef } from "react";
import { EDITOR_OPTIONS, monaco } from "../monaco";

/**
 * diff: 이전과 이후를 나란히 비교한다.
 * added, removed, context: 한쪽만 있는 코드(추가, 삭제된 메서드, 바뀌지 않은 진입점)를 한 칸으로 보여준다.
 */
export type ViewKind = "diff" | "added" | "removed" | "context";

export interface DiffInput {
  kind: ViewKind;
  original: string;
  modified: string;
  language: string;
  /** 잘라낸 조각의 첫 줄이 원본 파일의 몇 번째 줄인지(1부터). 줄 번호를 원래대로 보여준다 */
  originalStart: number;
  modifiedStart: number;
  /** 파일 전체를 비교할 때 바뀌지 않은 구간을 접는다 */
  collapseUnchanged: boolean;
  /** 처음 보여줄 head 쪽 줄(원본 파일 기준, 1부터) */
  revealLine: number | null;
}

interface Props {
  input: DiffInput;
  /** head 쪽 원본 파일 기준 줄 번호(1부터) */
  highlightLine: number | null;
  label: string;
}

export function DiffView(props: Props) {
  return props.input.kind === "diff" ? <SideBySide {...props} /> : <SingleView {...props} />;
}

function SideBySide({ input, highlightLine, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const models = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const e = monaco.editor.createDiffEditor(host.current!, {
      ...EDITOR_OPTIONS,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 700,
      diffWordWrap: "on",
    });
    // 모델을 매번 만들고 버리면 계산 중인 diff가 버려진 모델을 찾다 오류가 난다. 한 쌍을 두고 내용만 바꾼다
    const original = monaco.editor.createModel("", "plaintext");
    const modified = monaco.editor.createModel("", "plaintext");
    e.setModel({ original, modified });
    editor.current = e;
    models.current = { original, modified };
    decorations.current = e.getModifiedEditor().createDecorationsCollection();
    return () => {
      e.dispose();
      original.dispose();
      modified.dispose();
    };
  }, []);

  useEffect(() => {
    const e = editor.current!;
    const m = models.current!;
    monaco.editor.setModelLanguage(m.original, input.language);
    monaco.editor.setModelLanguage(m.modified, input.language);
    m.original.setValue(input.original);
    m.modified.setValue(input.modified);
    e.updateOptions({ hideUnchangedRegions: { enabled: input.collapseUnchanged, contextLineCount: 3, minimumLineCount: 6 } });
    e.getOriginalEditor().updateOptions({ lineNumbers: (n: number) => String(n + input.originalStart - 1), ariaLabel: `${label}, 이전` });
    e.getModifiedEditor().updateOptions({ lineNumbers: (n: number) => String(n + input.modifiedStart - 1), ariaLabel: `${label}, 이후` });
    decorations.current?.clear();
    const target = input.revealLine !== null ? input.revealLine - input.modifiedStart + 1 : 1;
    e.getModifiedEditor().revealLineNearTop(target);
    e.getOriginalEditor().setScrollTop(0);
  }, [input, label]);

  useEffect(() => {
    if (highlightLine === null) {
      decorations.current?.clear();
      return;
    }
    const line = highlightLine - input.modifiedStart + 1;
    decorations.current?.set([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "line-highlight" } }]);
    editor.current!.getModifiedEditor().revealLineInCenterIfOutsideViewport(line);
  }, [highlightLine, input]);

  return <div className="diff" ref={host} data-testid="diff" />;
}

function SingleView({ input, highlightLine, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const tint = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const mark = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const removed = input.kind === "removed";
  const text = removed ? input.original : input.modified;
  const start = removed ? input.originalStart : input.modifiedStart;

  useEffect(() => {
    const e = monaco.editor.create(host.current!, { ...EDITOR_OPTIONS, model: monaco.editor.createModel("", "plaintext") });
    editor.current = e;
    tint.current = e.createDecorationsCollection();
    mark.current = e.createDecorationsCollection();
    return () => {
      const model = e.getModel();
      e.dispose();
      model?.dispose();
    };
  }, []);

  useEffect(() => {
    const e = editor.current!;
    const model = e.getModel()!;
    monaco.editor.setModelLanguage(model, input.language);
    model.setValue(text);
    const sideLabel = input.kind === "added" ? "추가된 코드" : input.kind === "removed" ? "삭제된 코드" : "바뀌지 않은 코드";
    e.updateOptions({ lineNumbers: (n: number) => String(n + start - 1), ariaLabel: `${label}, ${sideLabel}` });
    const cls = input.kind === "added" ? "line-added" : input.kind === "removed" ? "line-removed" : null;
    tint.current!.set(cls ? [{ range: new monaco.Range(1, 1, model.getLineCount(), 1), options: { isWholeLine: true, className: cls, linesDecorationsClassName: `${cls}-gutter` } }] : []);
    e.setScrollTop(0);
  }, [input, label, text, start]);

  useEffect(() => {
    if (highlightLine === null || removed) {
      mark.current?.clear();
      return;
    }
    const line = highlightLine - start + 1;
    mark.current?.set([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "line-highlight" } }]);
    editor.current!.revealLineInCenterIfOutsideViewport(line);
  }, [highlightLine, input, removed, start]);

  return <div className="diff" ref={host} data-testid="diff" data-view={input.kind} />;
}
