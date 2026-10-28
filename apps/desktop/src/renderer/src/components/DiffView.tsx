import { useEffect, useRef } from "react";
import { monaco } from "../monaco";

export interface DiffInput {
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

/** 읽기 전용 Monaco diff. highlightLine은 head 쪽 원본 파일 기준 줄 번호(1부터) */
export function DiffView({ input, highlightLine, label }: { input: DiffInput; highlightLine: number | null; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const e = monaco.editor.createDiffEditor(host.current!, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 700,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      fontSize: 13,
      lineHeight: 20,
      wordWrap: "on",
      diffWordWrap: "on",
      wrappingIndent: "indent",
    });
    editor.current = e;
    return () => {
      const model = e.getModel();
      e.dispose();
      model?.original.dispose();
      model?.modified.dispose();
    };
  }, []);

  useEffect(() => {
    const e = editor.current!;
    const prev = e.getModel();
    const original = monaco.editor.createModel(input.original, input.language);
    const modified = monaco.editor.createModel(input.modified, input.language);
    e.updateOptions({ hideUnchangedRegions: { enabled: input.collapseUnchanged, contextLineCount: 3, minimumLineCount: 6 } });
    e.setModel({ original, modified });
    e.getOriginalEditor().updateOptions({ lineNumbers: (n: number) => String(n + input.originalStart - 1), ariaLabel: `${label}, 이전` });
    e.getModifiedEditor().updateOptions({ lineNumbers: (n: number) => String(n + input.modifiedStart - 1), ariaLabel: `${label}, 이후` });
    decorations.current = e.getModifiedEditor().createDecorationsCollection();
    if (input.revealLine !== null) {
      const line = input.revealLine - input.modifiedStart + 1;
      e.getModifiedEditor().revealLineNearTop(line);
    }
    prev?.original.dispose();
    prev?.modified.dispose();
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
