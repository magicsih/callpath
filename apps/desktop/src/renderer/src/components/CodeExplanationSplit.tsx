import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CodeNote } from "@callpath/llm";
import { monaco } from "../monaco";

export type RegisterReadingEditor = (source: string, editor: monaco.editor.IStandaloneCodeEditor, firstLine: number) => () => void;
type LinkedEditor = { editor: monaco.editor.IStandaloneCodeEditor; firstLine: number };
const keyOf = (n: CodeNote) => `${n.source}:${n.kind}:${n.line}:${n.endLine}`;

/** 원본 편집기는 그대로 두고 별도 설명 창에서 파일 줄 범위를 따라 읽는다. */
export function CodeExplanationSplit({ notes, enabled, children }: {
  notes: CodeNote[]; enabled: boolean; children: (register: RegisterReadingEditor) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null), pane = useRef<HTMLDivElement>(null);
  const codeId = useId();
  const [ratio, setRatio] = useState(64);
  const [editors, setEditors] = useState<Record<string, LinkedEditor>>({});
  const [source, setSource] = useState("head"), [line, setLine] = useState(1);
  const selected = useRef(source); selected.current = source;
  const register = useCallback<RegisterReadingEditor>((id, editor, firstLine) => {
    const linked = { editor, firstLine };
    setEditors(old => ({ ...old, [id]: linked }));
    const read = () => {
      if (selected.current !== id) return;
      const ranges = editor.getVisibleRanges(), cursor = editor.getPosition()?.lineNumber;
      const visibleCursor = cursor && ranges.some(r => r.startLineNumber <= cursor && cursor <= r.endLineNumber);
      setLine((visibleCursor ? cursor : ranges[0]?.startLineNumber ?? 1) + firstLine - 1);
    };
    const focus = editor.onDidFocusEditorText(() => { selected.current = id; setSource(id); read(); });
    const scroll = editor.onDidScrollChange(read);
    const cursor = editor.onDidChangeCursorPosition(() => { if (editor.hasTextFocus()) read(); });
    const model = editor.onDidChangeModelContent(read);
    return () => {
      focus.dispose(); scroll.dispose(); cursor.dispose(); model.dispose();
      setEditors(old => { if (old[id] !== linked) return old; const next = { ...old }; delete next[id]; return next; });
    };
  }, []);
  const ids = Object.keys(editors);
  const current = editors[source] ? source : editors.head ? "head" : ids[0] ?? "code";
  useEffect(() => { if (source !== current) { selected.current = current; setSource(current); } }, [source, current]);
  const shown = notes.filter(n => n.source === current).sort((a, b) => a.line - b.line || (a.kind === b.kind ? 0 : a.kind === "class" ? -1 : 1));
  const block = shown.find(n => n.kind === "block" && n.line <= line && line <= n.endLine)
    ?? shown.filter(n => n.line <= line).at(-1) ?? shown[0];
  const activeKey = block ? keyOf(block) : "";
  useLayoutEffect(() => {
    const container = pane.current;
    const active = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !active) return;
    const top = active.offsetTop, bottom = top + active.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
  }, [activeKey, enabled]);
  useEffect(() => {
    const linked = editors[current];
    if (!linked) return;
    const decoration = linked.editor.createDecorationsCollection();
    if (enabled && block) decoration.set([{
      range: new monaco.Range(Math.max(1, block.line - linked.firstLine + 1), 1, Math.max(1, block.endLine - linked.firstLine + 1), 1),
      options: { isWholeLine: true, className: "reading-code-range", linesDecorationsClassName: "reading-code-gutter" },
    }]);
    return () => decoration.clear();
  }, [editors, current, activeKey, enabled]);
  const reveal = (note: CodeNote) => {
    const linked = editors[note.source]; if (!linked) return;
    const from = note.line - linked.firstLine + 1, to = note.endLine - linked.firstLine + 1;
    linked.editor.revealRangeInCenterIfOutsideViewport(new monaco.Range(from, 1, to, 1));
    linked.editor.setPosition({ lineNumber: from, column: 1 });
    selected.current = note.source; setSource(note.source); setLine(note.line);
  };
  return <div ref={root} className={`code-explanation-split${enabled ? " enabled" : ""}`} data-testid="code-explanation-split" style={{ "--code-share": `${ratio}%` } as CSSProperties}>
    <div id={codeId} className="reading-code-pane">{children(register)}</div>
    {enabled && <>
      <div className="reading-divider" role="separator" tabIndex={0} aria-label="코드" aria-controls={codeId} aria-orientation="vertical" aria-valuemin={35} aria-valuemax={80} aria-valuenow={Math.round(ratio)}
        onDoubleClick={() => setRatio(64)}
        onKeyDown={e => {
          const value = e.key === "ArrowLeft" ? ratio - 5 : e.key === "ArrowRight" ? ratio + 5 : e.key === "Home" ? 35 : e.key === "End" ? 80 : null;
          if (value === null) return; e.preventDefault(); setRatio(Math.max(35, Math.min(80, value)));
        }}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const rect = root.current!.getBoundingClientRect(); setRatio(Math.max(35, Math.min(80, (e.clientX - rect.left) / rect.width * 100))); }}
        onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />
      <section className="reading-pane" aria-label="코드 설명" data-testid="reading-pane">
        {ids.includes("base") && ids.includes("head") && <div className="reading-sources" role="group" aria-label="설명할 코드 시점">
          {[['base', '이전 코드'], ['head', '이후 코드']].map(([id, name]) => <button key={id} className="small" aria-pressed={current === id} onClick={() => { selected.current = id!; setSource(id!); setLine((editors[id!]!.editor.getVisibleRanges()[0]?.startLineNumber ?? 1) + editors[id!]!.firstLine - 1); }}>{name}</button>)}
        </div>}
        <div ref={pane} className="reading-notes">
          {!shown.length && <p className="reading-empty muted">코드를 읽으며 구간별 설명을 준비합니다.</p>}
          {shown.map(note => <article key={keyOf(note)} className={`reading-note ${note.kind}`} data-testid="reading-note" data-source={note.source} data-line={note.line} data-end-line={note.endLine} data-active={keyOf(note) === activeKey}>
            <button className="link reading-range" aria-label={`${note.line === note.endLine ? note.line : `${note.line}–${note.endLine}`}줄 코드로 이동`} onClick={() => reveal(note)}>{note.line === note.endLine ? note.line : `${note.line}–${note.endLine}`}줄</button>
            <p>{note.text}</p>
          </article>)}
        </div>
      </section>
    </>}
  </div>;
}
