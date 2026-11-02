import type { RepoGuide, Tour, TourStep } from "@callpath/core";
import type { GuideTarget, LlmSettingsView } from "../../../shared/api";
import { useAutomatic } from "../useAutomatic";
import { branchText, stepName } from "../guideNav";

export function FlowReading({ guide, target, entryId, tour, step, settings, active, onEntry, onStep, onCode }: {
  guide: RepoGuide; target: GuideTarget; entryId: string | null; tour: Tour | null; step: number; settings: LlmSettingsView | null; active: boolean;
  onEntry: (id: string) => void; onStep: (step: TourStep) => void; onCode: (step: TourStep) => void;
}) {
  const state = useAutomatic(entryId ? { kind: "route", target, entryId } : null, settings, active);
  if (!settings?.enabled || !guide.entries.length) return null;
  const current = tour?.steps.find(s => s.n === step) ?? tour?.steps[0];
  const explanation = state.notes.find(n => "step" in n && n.step === current?.n);
  return <section className="flow-reading" aria-label="지도 흐름 설명" data-testid="flow-reading">
    <div className="automatic-controls"><strong>흐름 읽기</strong>
      <label>진입점 <select aria-label="설명할 진입점" value={entryId ?? ""} onChange={e => onEntry(e.target.value)}>{guide.entries.map(e => <option value={e.id} key={e.id}>{e.label}</option>)}</select></label>
      <span className="muted small" role="status">{state.status === "loading" ? "흐름 설명 작성 중" : state.status === "error" ? "흐름 설명 작성 실패" : state.status === "stopped" ? "흐름 설명 중단" : state.cached ? "저장된 흐름 설명" : "분석된 호출 순서"}</span>
      {state.status === "loading" ? <button className="small" onClick={state.stop}>멈추기</button> : <button className="small" onClick={state.retry}>다시 작성</button>}
    </div>
    {tour && <ol className="flow-reading-steps" aria-label="지도 호출 단계">{tour.steps.map(s => <li key={s.n}><button aria-current={current?.n === s.n ? "step" : undefined} onClick={() => onStep(s)} title={branchText(s, true) ?? (s.parent ? `${s.parent}단계에서 호출` : "진입점")}><span className="num">{s.n}</span>{stepName(tour, s)}{s.branch && <span className="flag ref">{branchText(s, false)}</span>}{s.confidence === "low" && <span className="flag low">연결 불확실</span>}</button></li>)}</ol>}
    {current && <div className="flow-reading-detail"><p data-testid="flow-step-explanation"><strong>{current.n}. {tour && stepName(tour, current)}</strong> {explanation?.text ?? (state.status === "loading" ? "이 단계 설명을 작성하고 있습니다." : "이 단계의 설명이 아직 없습니다.")}</p><div className="automatic-controls"><button className="small" onClick={() => onCode(current)}>이 단계 코드 읽기</button><button className="small" disabled={!tour || current.n >= tour.steps.length} onClick={() => { const next = tour?.steps.find(s => s.n === current.n + 1); if (next) onStep(next); }}>다음 단계</button>{current.parent && <span className="muted small">{current.parent}단계에서 호출{current.alternatives > 1 ? ", 구현 또는 연결 후보" : ""}</span>}</div></div>}
    {state.status === "error" && <p className="error-text small" role="alert">{state.error}</p>}
    {state.info && <p className="automatic-scope muted">{state.info.endpointHost} · {state.info.model} · 이 흐름의 메서드와 호출 구조{state.info.scopes.some(s => s.truncated) ? ", 코드 일부 생략" : ""} <button className="link" onClick={() => void window.callpath.showLlmLog()}>기록 보기</button></p>}
  </section>;
}
