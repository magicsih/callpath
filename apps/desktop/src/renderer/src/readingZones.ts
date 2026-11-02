import type { CodeNote } from "@callpath/llm";
import { monaco } from "./monaco";

/** 설명은 원본 모델에 넣지 않는다. 파일 줄 번호, 코드 복사와 diff는 그대로 둔다. */
export function readingZones(editor: monaco.editor.IStandaloneCodeEditor, notes: CodeNote[], source: string, firstLine: number): () => void {
  const model = editor.getModel();
  if (!model) return () => undefined;
  const ids: string[] = [], nodes: HTMLDivElement[] = [];
  const zones: monaco.editor.IViewZone[] = [];
  const preserve = (fn: () => void) => {
    const scroll = editor.getScrollTop(), anchor = editor.getVisibleRanges()[0]?.startLineNumber;
    const offset = anchor ? scroll - editor.getTopForLineNumber(anchor) : 0;
    fn();
    if (scroll > 40 && anchor) editor.setScrollTop(editor.getTopForLineNumber(anchor) + offset);
  };
  preserve(() => editor.changeViewZones(a => {
    for (const note of notes.filter(n => n.source === source).sort((a, b) => a.line - b.line || (a.kind === "class" ? -1 : 1))) {
      const line = note.line - firstLine + 1;
      if (line < 1 || line > model.getLineCount()) continue;
      const node = document.createElement("div");
      node.className = `reading-note ${note.kind}`;
      node.dataset.testid = "reading-note"; node.dataset.line = String(note.line); node.dataset.source = source;
      node.setAttribute("role", "note"); node.setAttribute("aria-label", `${note.line}줄 ${note.kind === "class" ? "클래스 설명" : "설명"}`);
      const label = document.createElement("span"); label.className = "reading-label"; label.textContent = note.kind === "class" ? "클래스 설명" : "가상 주석";
      const body = document.createElement("span"); body.textContent = note.text;
      const content = document.createElement("div"); content.className = "reading-note-content"; content.append(label, body); node.append(content); nodes.push(node);
      const zone: monaco.editor.IViewZone = { afterLineNumber: line - 1, heightInPx: 40, domNode: node, suppressMouseDown: false, showInHiddenAreas: false, ordinal: note.kind === "class" ? 1 : 2 };
      zones.push(zone); ids.push(a.addZone(zone));
    }
  }));
  let disposed = false;
  const measure = () => {
    if (disposed || editor.getModel() !== model) return;
    const changed: number[] = [];
    nodes.forEach((node, i) => {
      node.style.width = `${Math.max(120, editor.getLayoutInfo().contentWidth - 24)}px`;
      const height = Math.ceil(node.firstElementChild!.getBoundingClientRect().height) + 8;
      if (zones[i]!.heightInPx !== height) { zones[i]!.heightInPx = height; changed.push(i); }
    });
    if (changed.length) preserve(() => editor.changeViewZones(a => changed.forEach(i => a.layoutZone(ids[i]!))));
  };
  // DOM 내부를 별도 측정해 고정 높이 대신 설명 높이만큼 확장한다
  const ro = new ResizeObserver(() => measure());
  for (const node of nodes) if (node.lastElementChild) ro.observe(node.firstElementChild!);
  const layout = editor.onDidLayoutChange(measure);
  measure();
  return () => { disposed = true; ro.disconnect(); layout.dispose(); if (editor.getModel() === model) preserve(() => editor.changeViewZones(a => ids.forEach(id => a.removeZone(id)))); };
}
