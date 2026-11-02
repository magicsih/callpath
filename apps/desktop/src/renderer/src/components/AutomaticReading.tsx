import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CodeNote } from "@callpath/llm";
import type { AutomaticRequest, LlmSettingsView } from "../../../shared/api";
import { useAutomatic } from "../useAutomatic";

type CodeRequest = Extract<AutomaticRequest, { kind: "code" }>;
export function AutomaticReading({ request, settings, active, onSettings, children }: {
  request: CodeRequest | null; settings: LlmSettingsView | null; active: boolean; onSettings: () => void;
  children: (notes: CodeNote[], onVisibleLine: (source: string, line: number) => void) => ReactNode;
}) {
  const identity = JSON.stringify(request);
  const [anchors, setAnchors] = useState<Record<string, number>>({});
  const [collected, setCollected] = useState<{ identity: string; notes: CodeNote[] }>({ identity: "", notes: [] });
  const [shown, setShown] = useState(true);
  useEffect(() => { setAnchors({}); setCollected({ identity, notes: [] }); }, [identity]);
  const req = useMemo<CodeRequest | null>(() => request && ({ ...request, sources: request.sources.map(s => ({ ...s, from: Math.max(s.from, anchors[s.id] ?? s.from) })) }), [identity, anchors]);
  const state = useAutomatic(req, settings, active);
  useEffect(() => {
    const notes = state.notes.filter((n): n is CodeNote => "source" in n);
    if (!notes.length) return;
    setCollected(old => ({ identity, notes: [...new Map([...(old.identity === identity ? old.notes : []), ...notes].map(n => [`${n.source}:${n.line}:${n.kind}`, n])).values()] }));
  }, [state.notes]);
  const visible = (source: string, line: number) => {
    const scope = state.info?.scopes.find(s => s.id === source);
    const original = request?.sources.find(s => s.id === source);
    if (!scope || !original || state.status === "loading" || line < original.from || line > original.to) return;
    if (line < scope.from || line > scope.to - 10 && scope.to < original.to) {
      const from = Math.max(original.from, line - 5);
      setAnchors(a => a[source] === from ? a : { ...a, [source]: from });
    }
  };
  const notes = shown && collected.identity === identity ? collected.notes : [];
  return <div className="automatic-reading">
    {settings?.enabled && request && <div className="automatic-bar" data-testid="automatic-bar">
      <div className="automatic-controls">
        <label><input type="checkbox" checked={shown} onChange={e => setShown(e.target.checked)} />가상 주석</label>
        <span role="status" data-testid="automatic-status">{state.status === "loading" ? "설명 작성 중" : state.status === "error" ? "설명 작성 실패" : state.status === "stopped" ? "설명 작성 중단" : state.status === "ready" ? state.cached ? "저장된 설명" : "설명 준비됨" : "설명 대기"}</span>
        {state.status === "loading" ? <button className="small" onClick={state.stop}>멈추기</button> : <button className="small" onClick={state.retry}>다시 작성</button>}
        <button className="link small" onClick={onSettings}>LLM 설정</button>
      </div>
      <div className="automatic-scope muted">{state.info ? `${state.info.endpointHost} · ${state.info.model} · ${state.info.scopes.map(s => `${s.id === "base" ? "이전 " : s.id === "head" ? "이후 " : ""}${s.path.split("/").pop()}:${s.from}~${s.to}${s.truncated ? " (이 구간 설명)" : ""}`).join(", ")}` : "현재 코드 구간을 설정된 모델로 보내 설명합니다."} <button className="link" onClick={() => void window.callpath.showLlmLog()}>기록 보기</button></div>
      {state.status === "error" && <p className="error-text small" role="alert">{state.error} {collected.notes.length > 0 && "아래에는 작성이 끝난 구간만 표시합니다."}</p>}
    </div>}
    <div className="automatic-content">{children(notes, visible)}</div>
  </div>;
}
