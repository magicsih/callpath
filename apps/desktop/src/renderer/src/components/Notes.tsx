import { useEffect, useRef, useState } from "react";
import type { Note, PostPlan, PostResult, PrMeta } from "../../../shared/api";
import { Icon } from "./Icon";

/** 한 번 더 눌러야 실행되는 지우기 버튼. 다른 곳으로 초점이 가면 처음 상태로 돌아간다 */
function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="confirm" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setArmed(false)}>
      <button className="link small danger" onClick={onConfirm} autoFocus aria-label={`${label} 확인`}>지우기 확인</button>
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
            aria-label={`게시된 ${n.posted.mode === "line" ? "줄 코멘트" : "일반 코멘트"}를 브라우저로 열기`}
            data-testid="note-posted"
          >
            <Icon name="check" size={11} /> 게시됨({n.posted.mode === "line" ? "줄 코멘트" : "일반 코멘트"})
          </button>
        ) : (
          <span className="muted small">로컬 메모</span>
        )}
        <ConfirmDelete label={`${where(n)} 메모 "${snippet(n.body)}" 지우기`} onConfirm={() => props.onDelete(n)} />
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
      {current.length === 0 ? (
        <p className="muted small">아직 메모가 없습니다. 코드에서 줄을 고르고 m을 누르면 남깁니다.</p>
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

type Phase = { s: "planning" } | { s: "ready"; plans: PostPlan[] } | { s: "posting"; plans: PostPlan[] } | { s: "done"; plans: PostPlan[]; results: PostResult[] } | { s: "error"; message: string };

/** 게시 미리보기. 확인해야 올라가고, 줄 코멘트와 일반 코멘트를 구분해 보인다 */
export function PostDialog({ pr, ids, onClose, onPosted }: { pr: PrMeta; ids: number[]; onClose: () => void; onPosted: () => void }) {
  const [phase, setPhase] = useState<Phase>({ s: "planning" });
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const retryBtn = useRef<HTMLButtonElement>(null);
  const where = (p: PostPlan) => `${p.path.split("/").pop()}:${p.line}`;
  useEffect(() => {
    // 연 곳으로 초점을 돌려놓으려고 기억한다. showModal은 대화상자 밖을 막고 Esc를 cancel로 보낸다
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    cancelBtn.current?.focus();
    let alive = true;
    window.callpath.planPost(pr, ids).then((r) => alive && setPhase(r.ok ? { s: "ready", plans: r.value } : { s: "error", message: r.error }));
    return () => {
      alive = false;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>("[data-testid=notes-toggle]")?.focus();
    };
  }, []);
  useEffect(() => {
    // 밖으로 올리는 일이라 첫 초점은 취소에 둔다. 실패가 있으면 다시 올리기에 둔다
    if (phase.s === "done" && retryBtn.current) retryBtn.current.focus();
    else if (phase.s !== "posting") cancelBtn.current?.focus();
  }, [phase.s]);
  const post = async (plans: PostPlan[]) => {
    setPhase({ s: "posting", plans });
    const r = await window.callpath.postNotes(pr, plans);
    // 연결이 사라지는 등 시작부터 실패하면 대화상자를 닫을 수 있게 오류 단계로 간다
    if (!r.ok) return setPhase({ s: "error", message: r.error });
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
      {phase.s === "error" && <p className="error-text" role="alert"><Icon name="warn" /> {phase.message}</p>}
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
      <div className="row">
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
      {phase.s === "done" && failed.length === 0 && <p className="ok-text" role="status" data-testid="post-done">{phase.plans.length}개를 올렸습니다.</p>}
    </dialog>
  );
}
