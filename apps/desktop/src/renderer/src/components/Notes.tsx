import { useEffect, useRef, useState } from "react";
import type { Note, PostPlan, PostResult, PrMeta } from "../../../shared/api";
import { Icon } from "./Icon";

/** 상단 바의 "메모" 버튼으로 여는 서랍. 좁은 창에서도 쓸 수 있게 오른쪽 영역과 따로 둔다 */
export function NotesDrawer(props: {
  notes: Note[];
  pr: PrMeta | null;
  onClose: () => void;
  onGo: (n: Note) => void;
  onDelete: (n: Note) => void;
  onPost: (ids: number[]) => void;
}) {
  const unposted = props.notes.filter((n) => !n.posted);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <aside
      className="drawer"
      ref={ref}
      tabIndex={-1}
      aria-labelledby="notes-title"
      data-testid="notes-drawer"
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      <div className="drawer-head">
        <h2 id="notes-title" className="pane-title">메모 {props.notes.length}</h2>
        <span className="spacer" />
        <button className="link" onClick={props.onClose}>닫기</button>
      </div>
      {props.notes.length === 0 ? (
        <p className="muted small">아직 메모가 없습니다. 코드에서 줄을 고르고 m을 누르면 남깁니다.</p>
      ) : (
        <ul className="notes">
          {props.notes.map((n) => (
            <li key={n.id} className="note" data-testid="note-row">
              <button className="note-go" onClick={() => props.onGo(n)} title={`${n.path}:${n.line}`}>
                <span className="note-where">{n.path.split("/").pop()}:{n.line}</span>
                <span className="note-body">{n.body}</span>
              </button>
              <span className="note-meta">
                {n.posted ? (
                  <button className="link small" onClick={() => window.callpath.openExternal(n.posted!.url)} data-testid="note-posted">
                    <Icon name="check" size={11} /> 게시됨({n.posted.mode === "line" ? "줄 코멘트" : "일반 코멘트"})
                  </button>
                ) : (
                  <span className="muted small">로컬 메모</span>
                )}
                <button className="link small" onClick={() => props.onDelete(n)} aria-label={`${n.path}:${n.line} 메모 지우기`}>지우기</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {props.pr && unposted.length > 0 && (
        <button className="primary" onClick={() => props.onPost(unposted.map((n) => n.id))} data-testid="post-open">
          PR에 게시 ({unposted.length})
        </button>
      )}
      {!props.pr && props.notes.length > 0 && <p className="muted small">로컬 비교의 메모는 이 컴퓨터에만 남습니다. PR로 열면 PR에 게시할 수 있습니다.</p>}
    </aside>
  );
}

type Phase = { s: "planning" } | { s: "ready"; plans: PostPlan[] } | { s: "posting"; plans: PostPlan[] } | { s: "done"; plans: PostPlan[]; results: PostResult[] } | { s: "error"; message: string };

/** 게시 미리보기. 확인해야 올라가고, 줄 코멘트와 일반 코멘트를 구분해 보인다 */
export function PostDialog({ pr, ids, notes, onClose, onPosted }: { pr: PrMeta; ids: number[]; notes: Note[]; onClose: () => void; onPosted: () => void }) {
  const [phase, setPhase] = useState<Phase>({ s: "planning" });
  const where = (p: PostPlan) => `${p.path.split("/").pop()}:${p.line}`;
  useEffect(() => {
    let alive = true;
    window.callpath.planPost(pr, ids).then((r) => alive && setPhase(r.ok ? { s: "ready", plans: r.value } : { s: "error", message: r.error }));
    return () => {
      alive = false;
    };
  }, []);
  const post = async (plans: PostPlan[]) => {
    setPhase({ s: "posting", plans });
    const results = await window.callpath.postNotes(pr, plans);
    setPhase({ s: "done", plans, results });
    onPosted();
  };
  const failed = phase.s === "done" ? phase.plans.filter((p) => phase.results.find((r) => r.noteId === p.noteId && !r.ok)) : [];
  return (
    <div className="modal-back" onKeyDown={(e) => e.key === "Escape" && phase.s !== "posting" && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="post-title" data-testid="post-dialog">
        <h2 id="post-title">PR에 게시</h2>
        <p className="muted small">#{pr.number} {pr.title}</p>
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
                  {r && (r.ok ? <span className="ok-text small"><Icon name="check" size={11} /> 올라감</span> : <span className="error-text small"><Icon name="warn" size={11} /> {r.error}</span>)}
                </li>
              );
            })}
          </ul>
        )}
        <div className="row">
          {phase.s === "ready" && (
            <button className="primary" onClick={() => post(phase.plans)} autoFocus>
              게시 ({phase.plans.length})
            </button>
          )}
          {phase.s === "posting" && <button className="primary" disabled>게시 중</button>}
          {phase.s === "done" && failed.length > 0 && (
            <button className="primary" onClick={() => post(failed)} autoFocus>
              실패한 {failed.length}개 다시 올리기
            </button>
          )}
          <button onClick={onClose} disabled={phase.s === "posting"} autoFocus={phase.s === "done" && failed.length === 0}>
            {phase.s === "done" ? "닫기" : "취소"}
          </button>
        </div>
        {phase.s === "done" && failed.length === 0 && <p className="ok-text" role="status" data-testid="post-done">{phase.plans.length}개를 올렸습니다.</p>}
        {notes.length === 0 && null}
      </div>
    </div>
  );
}
