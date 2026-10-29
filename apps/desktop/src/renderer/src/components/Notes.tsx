import { useEffect, useRef, useState } from "react";
import type { ErrorKind, Note, PostPlan, PostResult, PrMeta } from "../../../shared/api";
import { Icon } from "./Icon";

/** 한 번 더 눌러야 실행되는 지우기 버튼. 다른 곳으로 초점이 가면 처음 상태로 돌아간다 */
function ConfirmDelete({ label, onConfirm, note }: { label: string; onConfirm: () => void; note?: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="confirm" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setArmed(false)}>
      {note && <span className="muted small">{note}</span>}
      <button className="link small danger" onClick={onConfirm} autoFocus aria-label={`${label} 확인${note ? `. ${note}` : ""}`}>지우기 확인</button>
      <button className="link small" onClick={() => setArmed(false)}>취소</button>
    </span>
  ) : (
    <button className="link small" onClick={() => setArmed(true)} aria-label={label}>지우기</button>
  );
}

const snippet = (body: string) => (body.length > 20 ? `${body.slice(0, 20)}…` : body);

/** 상단 바의 "메모" 버튼으로 여는 서랍. 좁은 창에서도 쓸 수 있게 오른쪽 영역과 따로 둔다 */
export function NotesDrawer(props: {
  notes: Note[];
  pr: PrMeta | null;
  /** 메모를 읽거나 지우지 못했을 때의 이유 */
  error: string | null;
  onClose: () => void;
  onGo: (n: Note) => void;
  onDelete: (n: Note) => void;
  onPost: (ids: number[]) => void;
}) {
  const current = props.notes.filter((n) => !n.stale);
  const stale = props.notes.filter((n) => n.stale);
  const unposted = current.filter((n) => !n.posted);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const where = (n: Note) => `${n.path.split("/").pop()}:${n.line}`;
  const row = (n: Note) => (
    <li key={n.id} className={`note${n.stale ? " stale" : ""}`} data-testid={n.stale ? "note-stale" : "note-row"}>
      {n.stale ? (
        <span className="note-go" title={`${n.path}:${n.line}`}>
          <span className="note-where">{where(n)}</span>
          <span className="note-body">{n.body}</span>
        </span>
      ) : (
        <button className="note-go" onClick={() => props.onGo(n)} title={`${n.path}:${n.line}`}>
          <span className="note-where">{where(n)}</span>
          <span className="note-body">{n.body}</span>
        </button>
      )}
      <span className="note-meta">
        {n.posted ? (
          <button
            className="link small"
            onClick={() => window.callpath.openExternal(n.posted!.url)}
            aria-label={`${where(n)} 메모 "${snippet(n.body)}"의 ${n.posted.mode === "line" ? "줄 코멘트" : "일반 코멘트"}를 브라우저로 열기`}
            data-testid="note-posted"
          >
            <Icon name="check" size={11} /> 게시됨({n.posted.mode === "line" ? "줄 코멘트" : "일반 코멘트"})
          </button>
        ) : (
          <span className="muted small">로컬 메모</span>
        )}
        <ConfirmDelete
          label={`${where(n)} 메모 "${snippet(n.body)}" 지우기`}
          onConfirm={() => props.onDelete(n)}
          {...(n.posted ? { note: "앱의 메모만 지웁니다. PR 코멘트는 남습니다" } : {})}
        />
      </span>
    </li>
  );
  return (
    <aside
      className="drawer"
      ref={ref}
      tabIndex={-1}
      aria-labelledby="notes-title"
      data-testid="notes-drawer"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <div className="drawer-head">
        <h2 id="notes-title" className="pane-title">메모 {current.length}</h2>
        <span className="spacer" />
        <button className="link" onClick={props.onClose}>닫기</button>
      </div>
      {props.error && (
        <p className="error-text small" role="alert" data-testid="notes-error">
          <Icon name="warn" size={12} /> {props.error}
        </p>
      )}
      {current.length === 0 ? (
        <p className="muted small">아직 메모가 없습니다. 오른쪽(변경 후) 코드에서 줄을 고르고 m을 누르면 남깁니다.</p>
      ) : (
        <ul className="notes" aria-label="흐름 순서로 정렬한 메모">{current.map(row)}</ul>
      )}
      {props.pr && unposted.length > 0 && (
        <button className="primary" onClick={() => props.onPost(unposted.map((n) => n.id))} data-testid="post-open">
          PR에 게시 ({unposted.length})
        </button>
      )}
      {!props.pr && current.length > 0 && <p className="muted small">로컬 비교의 메모는 이 컴퓨터에만 남습니다. PR로 열면 PR에 게시할 수 있습니다.</p>}
      {stale.length > 0 && (
        <section aria-labelledby="stale-title" className="stale-notes">
          <h3 id="stale-title" className="pane-title">이전 커밋에 남긴 메모 {stale.length}</h3>
          <p className="muted small">코드가 바뀌어 줄이 달라졌을 수 있어 게시하지 않습니다. 필요하면 지금 코드에서 다시 남기세요.</p>
          <ul className="notes">{stale.map(row)}</ul>
        </section>
      )}
    </aside>
  );
}

type Phase =
  | { s: "planning" }
  | { s: "ready"; plans: PostPlan[] }
  | { s: "posting"; plans: PostPlan[] }
  | { s: "done"; plans: PostPlan[]; results: PostResult[] }
  /** plans가 있으면 올리다 실패한 것, 없으면 미리보기를 만들지 못한 것 */
  | { s: "error"; message: string; kind: ErrorKind; plans?: PostPlan[] };

/** 게시 미리보기. 확인해야 올라가고, 줄 코멘트와 일반 코멘트를 구분해 보인다 */
export function PostDialog({ pr, ids, onClose, onPosted }: { pr: PrMeta; ids: number[]; onClose: () => void; onPosted: () => void }) {
  const [phase, setPhase] = useState<Phase>({ s: "planning" });
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const retryBtn = useRef<HTMLButtonElement>(null);
  const where = (p: PostPlan) => `${p.path.split("/").pop()}:${p.line}`;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt === 0) return;
    let alive = true;
    setPhase({ s: "planning" });
    window.callpath.planPost(pr, ids).then((r) => alive && setPhase(r.ok ? { s: "ready", plans: r.value } : { s: "error", message: r.error, kind: r.kind }));
    return () => {
      alive = false;
    };
  }, [attempt]);
  useEffect(() => {
    // 연 곳으로 초점을 돌려놓으려고 기억한다. showModal은 대화상자 밖을 막고 Esc를 cancel로 보낸다
    const opener = document.activeElement as HTMLElement | null;
    const d = dialog.current;
    // 개발 모드(StrictMode)는 효과를 설치, 정리, 재설치로 두 번 돌린다. 열린 대화상자에 showModal을 다시 부르면 예외가 난다
    if (d && !d.open) d.showModal();
    cancelBtn.current?.focus();
    let alive = true;
    window.callpath.planPost(pr, ids).then((r) => alive && setPhase(r.ok ? { s: "ready", plans: r.value } : { s: "error", message: r.error, kind: r.kind }));
    return () => {
      alive = false;
      if (d?.open) d.close();
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>("[data-testid=notes-toggle]")?.focus();
    };
  }, []);
  useEffect(() => {
    // 밖으로 올리는 일이라 첫 초점은 취소에 둔다. 실패가 있으면 다시 올리기에 둔다
    if ((phase.s === "done" || phase.s === "error") && retryBtn.current) retryBtn.current.focus();
    else if (phase.s !== "posting") cancelBtn.current?.focus();
  }, [phase.s]);
  const post = async (plans: PostPlan[]) => {
    setPhase({ s: "posting", plans });
    const r = await window.callpath.postNotes(pr, plans);
    // 연결이 사라지는 등 시작부터 실패하면 대화상자를 닫을 수 있게 오류 단계로 간다
    if (!r.ok) return setPhase({ s: "error", message: r.error, kind: r.kind, plans });
    setPhase({ s: "done", plans, results: r.value });
    onPosted();
  };
  const failed = phase.s === "done" ? phase.plans.filter((p) => phase.results.find((r) => r.noteId === p.noteId && !r.ok)) : [];
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="post-title"
      data-testid="post-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (phase.s !== "posting") onClose();
      }}
    >
      <h2 id="post-title">PR에 게시</h2>
      <p className="muted small">
        {pr.host}/{pr.repo} #{pr.number} {pr.title}
      </p>
      {phase.s === "planning" && <p role="status">PR diff를 읽어 올릴 위치를 정하는 중</p>}
      {phase.s === "error" && (
        <div className="error-text" role="alert" data-testid="post-error">
          <Icon name="warn" />
          <span>
            {phase.message}
            <span className="block small">
              {phase.kind === "network" ? "연결이나 사내망(VPN)을 확인한 뒤 다시 시도하세요." : phase.kind === "auth" ? "연결 설정에서 토큰을 확인하세요." : phase.kind === "connection" ? "연결 설정에서 이 호스트를 추가하세요." : "잠시 뒤 다시 시도하세요."}
            </span>
          </span>
        </div>
      )}
      {(phase.s === "ready" || phase.s === "posting" || phase.s === "done") && (
        <ul className="plans">
          {phase.plans.map((p) => {
            const r = phase.s === "done" ? phase.results.find((x) => x.noteId === p.noteId) : undefined;
            return (
              <li key={p.noteId} className="plan" data-testid="post-plan">
                <span className={`chip ${p.mode === "line" ? "change-body" : ""}`}>{p.mode === "line" ? "줄 코멘트" : "일반 코멘트"}</span>
                <span className="note-where">{where(p)}</span>
                {p.mode === "general" && <span className="muted small">이 줄은 PR diff 밖이라 위치를 적은 일반 코멘트로 올라갑니다</span>}
                <pre className="plan-body">{p.body}</pre>
                {r &&
                  (r.ok ? (
                    <span className="ok-text small">
                      <Icon name="check" size={11} /> 올라감{" "}
                      <button className="link small" onClick={() => window.callpath.openExternal(r.url)} aria-label={`${where(p)} 코멘트를 브라우저로 열기`}>
                        코멘트 열기
                      </button>
                    </span>
                  ) : (
                    <span className="error-text small"><Icon name="warn" size={11} /> {r.error}</span>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {phase.s === "done" && failed.length === 0 && <p className="ok-text" role="status" data-testid="post-done">{phase.plans.length}개를 올렸습니다.</p>}
      <div className="row dialog-actions">
        {phase.s === "error" && (
          <button className="primary" ref={retryBtn} onClick={() => (phase.plans ? post(phase.plans) : setAttempt((n) => n + 1))}>
            다시 시도
          </button>
        )}
        {phase.s === "ready" && (
          <button className="primary" onClick={() => post(phase.plans)}>
            게시 ({phase.plans.length})
          </button>
        )}
        {phase.s === "posting" && <button className="primary" disabled>게시 중</button>}
        {phase.s === "done" && failed.length > 0 && (
          <button className="primary" ref={retryBtn} onClick={() => post(failed)}>
            실패한 {failed.length}개 다시 올리기
          </button>
        )}
        <button ref={cancelBtn} onClick={onClose} disabled={phase.s === "posting"}>
          {phase.s === "done" ? "닫기" : "취소"}
        </button>
      </div>
    </dialog>
  );
}
