import { useEffect, useRef, useState } from "react";
import type { ExplainPreview, ExplainTarget } from "../../../shared/api";
import { Icon } from "./Icon";

export interface SavedAnswer {
  title: string;
  text: string;
  time: number;
}

type Phase =
  | { s: "preparing" }
  | { s: "preview"; p: ExplainPreview }
  | { s: "streaming"; p: ExplainPreview; text: string }
  /** fromSaved: 지난번에 받아 둔 답을 다시 보이는 것 */
  | { s: "done"; title: string; text: string; stopped?: boolean; fromSaved?: boolean }
  | { s: "error"; message: string; kind: string; text?: string };

/**
 * 보낼 내용을 먼저 보이고, 확인하면 보내고 답을 조각씩 보인다(설계 3.4).
 * 같은 대상의 지난 답이 있으면 그 답을 먼저 보인다
 */
export function ExplainDialog(props: {
  req: { repo: string; base: string; head: string; target: ExplainTarget };
  saved: SavedAnswer | null;
  onAnswer: (a: SavedAnswer) => void;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(props.saved ? { s: "done", title: props.saved.title, text: props.saved.text, fromSaved: true } : { s: "preparing" });
  const [attempt, setAttempt] = useState(props.saved ? 0 : 1);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const runId = useRef<string | null>(null);
  const stopBtn = useRef<HTMLButtonElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onAnswer = useRef(props.onAnswer);
  onAnswer.current = props.onAnswer;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    cancelBtn.current?.focus();
    return () => {
      if (runId.current) void window.callpath.cancelExplain(runId.current);
      if (d?.open) d.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // 미리보기 만들기. 네트워크를 쓰지 않는다
  useEffect(() => {
    if (attempt === 0) return;
    let alive = true;
    setPhase({ s: "preparing" });
    void window.callpath.previewExplain(props.req).then((r) => {
      if (!alive) return;
      setPhase(r.ok ? { s: "preview", p: r.value } : { s: "error", message: r.error, kind: r.kind });
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    // 받는 동안에는 멈추기에, 그 밖에는 닫기(취소)에 초점을 둔다
    if (phase.s === "streaming") stopBtn.current?.focus();
    else cancelBtn.current?.focus();
  }, [phase.s]);

  useEffect(() => {
    return window.callpath.onLlmEvent((e) => {
      const cur = phaseRef.current;
      if (e.id !== runId.current || cur.s !== "streaming") return;
      let next: Phase;
      if (e.type === "chunk") next = { ...cur, text: cur.text + e.text };
      else {
        runId.current = null;
        if (e.type === "done") {
          next = { s: "done", title: cur.p.payload.title, text: cur.text };
          onAnswer.current({ title: cur.p.payload.title, text: cur.text, time: Date.now() });
        } else if (e.kind === "cancelled") next = { s: "done", title: cur.p.payload.title, text: cur.text, stopped: true };
        else next = { s: "error", message: e.error, kind: e.kind, text: cur.text };
      }
      // 조각이 연달아 와도 다음 조각이 최신 상태를 읽도록 바로 바꿔 둔다
      phaseRef.current = next;
      setPhase(next);
    });
  }, []);

  useEffect(() => {
    // 답이 길어지면 끝을 따라 내려간다
    if (phase.s === "streaming" && answerRef.current) answerRef.current.scrollTop = answerRef.current.scrollHeight;
  }, [phase]);

  const send = async (p: ExplainPreview) => {
    runId.current = p.id;
    setPhase({ s: "streaming", p, text: "" });
    const r = await window.callpath.sendExplain(p.id);
    if (!r.ok) {
      runId.current = null;
      setPhase({ s: "error", message: r.error, kind: r.kind });
    }
  };

  const title =
    phase.s === "preview" || phase.s === "streaming" ? phase.p.payload.title : phase.s === "done" ? phase.title : props.req.target.kind === "flow" ? "흐름 요약" : "메서드 설명";
  const guide = (kind: string) =>
    kind === "network" ? "끝점 주소와 연결, 사내망(VPN)을 확인한 뒤 다시 시도하세요." : kind === "auth" ? "LLM 설정에서 키를 확인하세요." : "잠시 뒤 다시 시도하세요.";

  return (
    <dialog
      ref={dialog}
      className="modal explain"
      aria-labelledby="explain-title"
      data-testid="explain-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (phase.s === "streaming") {
          void window.callpath.cancelExplain(phase.p.id);
          return;
        }
        props.onClose();
      }}
    >
      <h2 id="explain-title">{title}</h2>
      {phase.s === "preparing" && <p role="status">보낼 내용을 만드는 중</p>}

      {phase.s === "preview" && (
        <>
          <p className="banner small" data-testid="explain-dest">
            아래 내용을 <strong>{phase.p.endpointHost}</strong>의 <strong>{phase.p.model}</strong> 모델로 보냅니다. 보내기를 누르기 전에는 아무것도 나가지 않습니다.
          </p>
          <div className="explain-body">
            <h3 className="pane-title">보낼 코드 {phase.p.payload.scope.length}곳</h3>
            <ul className="plain small" data-testid="explain-scope">
              {phase.p.payload.scope.map((s) => (
                <li key={`${s.side}:${s.path}:${s.startLine}`}>
                  <span className="note-where">
                    {s.path}:{s.startLine}-{s.endLine}
                  </span>{" "}
                  <span className="muted">{s.side === "head" ? "변경 후" : "변경 전"}</span>
                </li>
              ))}
            </ul>
            {phase.p.payload.omitted > 0 && (
              <p className="muted small">한 번에 보내는 글자 상한을 넘어 코드 {phase.p.payload.omitted}곳은 빼고 보냅니다.</p>
            )}
            <h3 className="pane-title">호출 구조</h3>
            <pre className="plan-body">{phase.p.payload.graphSummary}</pre>
            <details>
              <summary>보낼 메시지 전체 보기 ({phase.p.payload.chars.toLocaleString()}자)</summary>
              {phase.p.payload.messages.map((m, i) => (
                <div key={i}>
                  <p className="muted small">{m.role === "system" ? "지시문" : "요청"}</p>
                  <pre className="plan-body" data-testid="explain-message">{m.content}</pre>
                </div>
              ))}
            </details>
          </div>
        </>
      )}

      {(phase.s === "streaming" || phase.s === "done" || (phase.s === "error" && phase.text)) && (
        <div className="explain-answer" ref={answerRef} aria-live="polite" aria-busy={phase.s === "streaming"} data-testid="explain-answer">
          {phase.s === "streaming" && !phase.text ? <p className="muted">답을 기다리는 중</p> : <div className="answer-text">{phase.text}</div>}
        </div>
      )}
      {phase.s === "done" && phase.stopped && <p className="muted small">답을 받다 멈췄습니다. 받은 데까지만 보입니다.</p>}
      {phase.s === "done" && phase.fromSaved && (
        <p className="muted small">지난번에 받은 답입니다. 코드가 바뀌었으면 다시 요청하세요.</p>
      )}
      {phase.s === "done" && <p className="muted small">LLM이 쓴 설명이라 틀릴 수 있습니다. 코드로 확인하세요.</p>}

      {phase.s === "error" && (
        <div className="error-text" role="alert" data-testid="explain-error">
          <Icon name="warn" />
          <span>
            {phase.message}
            <span className="block small">{guide(phase.kind)}</span>
          </span>
        </div>
      )}

      <div className="row dialog-actions">
        {phase.s === "preview" && (
          <button className="primary" onClick={() => void send(phase.p)}>
            보내기
          </button>
        )}
        {phase.s === "streaming" && (
          <button ref={stopBtn} onClick={() => void window.callpath.cancelExplain(phase.p.id)} data-testid="explain-stop">
            멈추기
          </button>
        )}
        {(phase.s === "done" || phase.s === "error") && (
          <button className={phase.s === "error" ? "primary" : ""} onClick={() => setAttempt((n) => n + 1)}>
            {phase.s === "error" ? "다시 시도" : "다시 요청"}
          </button>
        )}
        {phase.s === "error" && phase.kind === "auth" && <button onClick={props.onSettings}>LLM 설정</button>}
        <button ref={cancelBtn} onClick={props.onClose} disabled={phase.s === "streaming"}>
          {phase.s === "preview" || phase.s === "preparing" ? "취소" : "닫기"}
        </button>
      </div>
    </dialog>
  );
}

/** 오른쪽 영역 아래(좁은 창에서는 상세 머리)에 두는 LLM 버튼 두 개. 꺼져 있으면 켜는 길만 보인다 */
export function LlmActions(props: {
  enabled: boolean | null;
  onFlow: (() => void) | null;
  onMethod: (() => void) | null;
  flowAnswered: boolean;
  methodAnswered: boolean;
  onSettings: () => void;
  compact?: boolean;
}) {
  if (props.enabled === null) return null;
  if (!props.enabled) {
    return (
      <div className={`llm-actions${props.compact ? " compact" : ""}`} data-testid="llm-off">
        {!props.compact && <h2 className="pane-title">LLM 설명</h2>}
        <p className="muted small">
          꺼져 있습니다. <button className="link small" onClick={props.onSettings}>LLM 설정</button>
        </p>
      </div>
    );
  }
  return (
    <div className={`llm-actions${props.compact ? " compact" : ""}`} data-testid="llm-actions">
      {!props.compact && <h2 className="pane-title">LLM 설명</h2>}
      <div className="row">
        <button onClick={props.onFlow ?? undefined} disabled={!props.onFlow} title={props.onFlow ? undefined : "진입점에서 시작한 흐름 안의 단계에서 쓸 수 있습니다"}>
          이 흐름 요약{props.flowAnswered && <span className="muted small"> (받음)</span>}
        </button>
        <button onClick={props.onMethod ?? undefined} disabled={!props.onMethod}>
          이 메서드 설명{props.methodAnswered && <span className="muted small"> (받음)</span>}
        </button>
      </div>
      {!props.compact && <p className="muted small">누르면 보낼 내용을 먼저 보여 줍니다.</p>}
    </div>
  );
}
