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

/** 강조할 줄. 원본 파일 기준 줄 번호(1부터) */
export interface Highlight {
  original: number[];
  modified: number[];
}

interface Props {
  input: DiffInput;
  highlight: Highlight | null;
  label: string;
  /** 메모가 있는 head 쪽 줄(원본 파일 기준, 1부터) */
  notes?: Array<{ line: number; body: string }>;
  /** head 쪽 커서가 놓인 줄(원본 파일 기준)이 바뀔 때 */
  onCursorLine?: (line: number, side: "head" | "base") => void;
  /** 오른쪽 클릭 메뉴의 "이 줄에 메모" */
  onNoteRequest?: (line: number) => void;
  /** 값이 바뀌면 편집기로 초점을 돌린다(메모를 저장하거나 취소한 뒤) */
  focusNonce?: number;
}

/** 메모가 있는 줄에 표시를 달고, 마우스를 올리면 본문을 보인다 */
const noteDeco = (notes: Array<{ line: number; body: string }>, start: number) => {
  const byLine = new Map<number, string[]>();
  for (const n of notes) byLine.set(n.line, [...(byLine.get(n.line) ?? []), n.body]);
  return [...byLine].map(([l, bodies]) => ({
    range: new monaco.Range(l - start + 1, 1, l - start + 1, 1),
    options: { isWholeLine: false, glyphMarginClassName: "memo-glyph", glyphMarginHoverMessage: bodies.map((b) => ({ value: `**메모** ${b}` })) },
  }));
};

/** head 쪽 편집기에 현재 줄 알림과 메모 메뉴를 붙인다 */
function attachNoteHooks(ed: monaco.editor.IStandaloneCodeEditor, start: () => number, onCursor: () => ((l: number) => void) | undefined, onNote: () => ((l: number) => void) | undefined) {
  const subs = [
    ed.onDidChangeCursorPosition((e) => onCursor()?.(e.position.lineNumber + start() - 1)),
    ed.addAction({
      id: "callpath.note",
      label: "이 줄에 메모",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 0,
      run: (editor) => {
        const line = editor.getPosition()?.lineNumber ?? 1;
        onNote()?.(line + start() - 1);
      },
    }),
  ];
  return () => subs.forEach((s) => s.dispose());
}

const deco = (lines: number[], start: number) =>
  lines.map((l) => ({ range: new monaco.Range(l - start + 1, 1, l - start + 1, 1), options: { isWholeLine: true, className: "line-highlight" } }));

const INLINE_BREAKPOINT = 700;

export function DiffView(props: Props) {
  return props.input.kind === "diff" ? <SideBySide {...props} /> : <SingleView {...props} />;
}

function SideBySide({ input, highlight, label, notes, onCursorLine, onNoteRequest, focusNonce }: Props) {
  const startRef = useRef(input.modifiedStart);
  startRef.current = input.modifiedStart;
  const baseStartRef = useRef(input.originalStart);
  baseStartRef.current = input.originalStart;
  const cbs = useRef({ onCursorLine, onNoteRequest });
  cbs.current = { onCursorLine, onNoteRequest };
  const noteDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const models = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const baseDecorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    const e = monaco.editor.createDiffEditor(host.current!, {
      ...EDITOR_OPTIONS,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: INLINE_BREAKPOINT,
      diffWordWrap: "on",
      glyphMargin: true,
    });
    // 모델을 매번 만들고 버리면 계산 중인 diff가 버려진 모델을 찾다 오류가 난다. 한 쌍을 두고 내용만 바꾼다
    const original = monaco.editor.createModel("", "plaintext");
    const modified = monaco.editor.createModel("", "plaintext");
    e.setModel({ original, modified });
    editor.current = e;
    models.current = { original, modified };
    decorations.current = e.getModifiedEditor().createDecorationsCollection();
    baseDecorations.current = e.getOriginalEditor().createDecorationsCollection();
    noteDecos.current = e.getModifiedEditor().createDecorationsCollection();
    const detach = attachNoteHooks(e.getModifiedEditor(), () => startRef.current, () => (l) => cbs.current.onCursorLine?.(l, "head"), () => cbs.current.onNoteRequest);
    // 기준 쪽 줄을 골랐다는 것도 알려, 그 줄에는 메모를 남길 수 없다고 안내하게 한다
    const baseCursor = e.getOriginalEditor().onDidChangeCursorPosition((ev) => cbs.current.onCursorLine?.(ev.position.lineNumber + baseStartRef.current - 1, "base"));
    // 한 열 diff에서는 삭제된 줄이 줄바꿈되면 들여쓰기 없이 이어져 읽기 어렵다. 좁을 때는 이전 쪽만 줄바꿈을 끈다
    // 보기가 바뀌며 요소가 사라진 뒤에도 콜백이 한 번 더 올 수 있어 ref 대신 요소를 직접 잡는다
    const el = host.current!;
    let disposed = false;
    const fit = () => {
      if (!disposed) e.updateOptions({ diffWordWrap: el.clientWidth < INLINE_BREAKPOINT ? "off" : "on" });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => {
      disposed = true;
      detach();
      baseCursor.dispose();
      ro.disconnect();
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
    baseDecorations.current?.clear();
    const target = input.revealLine !== null ? input.revealLine - input.modifiedStart + 1 : 1;
    e.getModifiedEditor().revealLineNearTop(target);
    e.getOriginalEditor().setScrollTop(0);
  }, [input, label]);

  useEffect(() => {
    decorations.current?.set(deco(highlight?.modified ?? [], input.modifiedStart));
    baseDecorations.current?.set(deco(highlight?.original ?? [], input.originalStart));
    const m = highlight?.modified[0];
    const o = highlight?.original[0];
    if (m !== undefined) editor.current!.getModifiedEditor().revealLineInCenterIfOutsideViewport(m - input.modifiedStart + 1);
    if (o !== undefined) editor.current!.getOriginalEditor().revealLineInCenterIfOutsideViewport(o - input.originalStart + 1);
  }, [highlight, input]);

  useEffect(() => {
    noteDecos.current?.set(noteDeco(notes ?? [], input.modifiedStart));
  }, [notes, input]);
  useEffect(() => {
    if (focusNonce) editor.current?.getModifiedEditor().focus();
  }, [focusNonce]);

  return <div className="diff" ref={host} data-testid="diff" data-view="diff" />;
}

function SingleView({ input, highlight, label, notes, onCursorLine, onNoteRequest, focusNonce }: Props) {
  const cbs = useRef({ onCursorLine, onNoteRequest });
  cbs.current = { onCursorLine, onNoteRequest };
  const noteDecos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const tint = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const mark = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const removed = input.kind === "removed";
  const text = removed ? input.original : input.modified;
  const start = removed ? input.originalStart : input.modifiedStart;
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    const e = monaco.editor.create(host.current!, { ...EDITOR_OPTIONS, glyphMargin: true, model: monaco.editor.createModel("", "plaintext") });
    editor.current = e;
    tint.current = e.createDecorationsCollection();
    mark.current = e.createDecorationsCollection();
    noteDecos.current = e.createDecorationsCollection();
    // 삭제된 코드에는 메모를 남기지 않는다(메모는 head 쪽 줄에 묶인다)
    const detach = attachNoteHooks(e, () => startRef.current, () => (input.kind === "removed" ? undefined : (l) => cbs.current.onCursorLine?.(l, "head")), () => (input.kind === "removed" ? undefined : cbs.current.onNoteRequest));
    return () => {
      detach();
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
    const lines = (removed ? highlight?.original : highlight?.modified) ?? [];
    mark.current?.set(deco(lines, start));
    if (lines[0] !== undefined) editor.current!.revealLineInCenterIfOutsideViewport(lines[0] - start + 1);
  }, [highlight, input, removed, start]);

  useEffect(() => {
    noteDecos.current?.set(removed ? [] : noteDeco(notes ?? [], start));
  }, [notes, input, removed, start]);
  useEffect(() => {
    if (focusNonce) editor.current?.focus();
  }, [focusNonce]);

  return <div className="diff" ref={host} data-testid="diff" data-view={input.kind} />;
}
