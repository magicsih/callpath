import type { CodeNote } from "@callpath/llm";
import { monaco } from "./monaco";

/** 설명은 원본 모델에 넣지 않는다. 파일 줄 번호, 코드 복사와 diff는 그대로 둔다. */
export function readingZones(editor: monaco.editor.IStandaloneCodeEditor, notes: CodeNote[], source: string, firstLine: number): () => void {
  const model = editor.getModel();
  if (!model) return () => undefined;
  const ids: string[] = [], nodes: HTMLDivElement[] = [], measures: HTMLDivElement[] = [];
  const zones: monaco.editor.IViewZone[] = [];
  // Monaco는 화면 밖 주석을 display:none으로 숨긴다. 숨은 요소의 높이 0을 쓰지 않고
  // 같은 너비의 측정 영역에서 줄바꿈 높이를 구한다. 이 영역은 읽기와 클릭 대상에서 뺀다.
  const measurement = document.createElement("div");
  measurement.setAttribute("aria-hidden", "true");
  Object.assign(measurement.style, { position: "fixed", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none" });
  document.body.append(measurement);
  const preserve = (fn: () => void) => {
    const scroll = editor.getScrollTop(), visible = editor.getVisibleRanges();
    const cursor = editor.getPosition()?.lineNumber;
    const cursorVisible = cursor !== undefined && visible.some(r => cursor >= r.startLineNumber && cursor <= r.endLineNumber);
    // 선택한 메서드가 보이는 동안 그 줄을 고정한다. 위쪽에 설명이 늘어도 선택한 코드가 밀리지 않는다.
    const anchor = cursorVisible ? cursor : visible[0]?.startLineNumber;
    const offset = anchor ? scroll - editor.getTopForLineNumber(anchor) : 0;
    fn();
    if (anchor && (scroll > 40 || cursorVisible && anchor > 1)) editor.setScrollTop(editor.getTopForLineNumber(anchor) + offset);
  };
  preserve(() => editor.changeViewZones(a => {
    for (const note of notes.filter(n => n.source === source).sort((a, b) => a.line - b.line || (a.kind === "class" ? -1 : 1))) {
      const line = note.line - firstLine + 1;
      if (line < 1 || line > model.getLineCount()) continue;
      const node = document.createElement("div");
      node.className = `reading-note ${note.kind}`;
      node.dataset.testid = "reading-note"; node.dataset.line = String(note.line); node.dataset.source = source;
      const label = document.createElement("span"); label.className = "reading-label"; label.textContent = note.kind === "class" ? "클래스 설명" : "가상 주석";
      const body = document.createElement("span"); body.textContent = note.text;
      const content = document.createElement("div"); content.className = "reading-note-content"; content.append(label, body); node.append(content); nodes.push(node);
      const measured = document.createElement("div"); measured.className = `reading-measure ${note.kind}`;
      measured.append(content.cloneNode(true)); measurement.append(measured); measures.push(measured);
      const zone: monaco.editor.IViewZone = { afterLineNumber: line - 1, heightInPx: 40, domNode: node, suppressMouseDown: false, showInHiddenAreas: false, ordinal: note.kind === "class" ? 1 : 2 };
      zones.push(zone); ids.push(a.addZone(zone));
    }
  }));
  let disposed = false;
  const measure = () => {
    if (disposed || editor.getModel() !== model) return;
    const changed: number[] = [];
    const width = `${Math.max(120, editor.getLayoutInfo().contentWidth - 24)}px`;
    nodes.forEach((node, i) => {
      node.style.width = width; measures[i]!.style.width = width;
      const height = Math.ceil(measures[i]!.firstElementChild!.getBoundingClientRect().height) + 8;
      if (zones[i]!.heightInPx !== height) { zones[i]!.heightInPx = height; changed.push(i); }
    });
    if (changed.length) preserve(() => editor.changeViewZones(a => changed.forEach(i => a.layoutZone(ids[i]!))));
  };
  const ro = new ResizeObserver(measure);
  for (const node of measures) ro.observe(node);
  const layout = editor.onDidLayoutChange(measure);
  measure();
  return () => {
    disposed = true; ro.disconnect(); layout.dispose(); measurement.remove();
    if (editor.getModel() === model) preserve(() => editor.changeViewZones(a => ids.forEach(id => a.removeZone(id))));
  };
}
