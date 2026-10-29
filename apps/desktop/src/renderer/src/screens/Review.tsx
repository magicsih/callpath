import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewSession } from "@callpath/core";
import type { CompareRequest, ErrorKind, Note, PrMeta } from "../../../shared/api";
import { NotesDrawer, PostDialog } from "../components/Notes";
import { noteTarget } from "../components/Detail";
import { childSteps, neighbor, refTarget, resolveSelection, shortName, buildNav, CHANGE_LABEL, type NavItem, type StepItem } from "../nav";
import { FlowList } from "../components/FlowList";
import { Detail } from "../components/Detail";
import { StackPane } from "../components/StackPane";
import { Icon } from "../components/Icon";
import { PreciseBanner, PreciseChip, type PreciseView } from "../components/PreciseStatus";

/** run은 이 결과를 받은 분석 실행 번호. 정밀 분석 결과로 세션이 바뀌어도 그대로다 */
/** 메모를 흐름 순서(목록에 보이는 순서), 같은 항목 안에서는 줄 순서로 놓는다 */
function sortByFlow(nav: NonNullable<ReturnType<typeof buildNav>>, notes: Note[]): Note[] {
  const rank = (n: Note) => {
    const hit = findItemFor(nav, n.path, n.line);
    const i = hit ? nav.order.findIndex((x) => x.key === hit.key) : -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...notes].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path) || a.line - b.line || a.id - b.id);
}

/** 메모 위치가 들어 있는 항목. 단계, 테스트, 파일 순으로 찾는다 */
function findItemFor(nav: NonNullable<ReturnType<typeof buildNav>>, path: string, line: number): NavItem | null {
  const row = line - 1;
  const inRange = (r: { startLine: number; endLine: number }) => row >= r.startLine && row <= r.endLine;
  for (const g of nav.groups) for (const i of g.items) if (i.kind === "step" && !i.step.refOf && i.step.change !== "removed" && i.step.symbol.path === path && inRange(i.step.symbol.range)) return i;
  for (const tests of nav.testsOf.values()) for (const t of tests) if (t.test.symbol.path === path && inRange(t.test.symbol.range)) return t;
  for (const g of nav.groups) for (const i of g.items) if (i.kind === "file" && i.file.path === path) return i;
  return null;
}

type Analysis = { status: "loading" } | { status: "error"; message: string; kind: ErrorKind } | { status: "ready"; session: ReviewSession; run: number };

interface Props {
  req: CompareRequest;
  repoName: string;
  /** PR 리뷰면 그 PR */
  pr: PrMeta | null;
  /** PR을 새로 받는다(새 커밋 확인) */
  onRefreshPr: () => void;
  initialSelection: string | null;
  initialShowTests: boolean;
  onChangeCompare: () => void;
  onPersist: (selection: string | null, showTests: boolean) => void;
}

export function Review({ req, repoName, pr, onRefreshPr, initialSelection, initialShowTests, onChangeCompare, onPersist }: Props) {
  const [analysis, setAnalysis] = useState<Analysis>({ status: "loading" });
  const [run, setRun] = useState(0);
  const [showTests, setShowTests] = useState(initialShowTests);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelection);
  const history = useRef<string[]>([]);
  const rows = useRef(new Map<string, HTMLButtonElement>());

  const [precise, setPrecise] = useState<PreciseView>({ running: false, message: null, error: null });
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [posting, setPosting] = useState<number[] | null>(null);
  const [noteRequest, setNoteRequest] = useState(0);
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(null);
  const [bannerClosed, setBannerClosed] = useState(false);

  useEffect(() => {
    let alive = true;
    setAnalysis({ status: "loading" });
    setPrecise({ running: true, message: null, error: null });
    setBannerClosed(false);
    const same = (r: CompareRequest) => r.repo === req.repo && r.base === req.base && r.head === req.head;
    // 빠른 분석 결과를 먼저 보이고, 정밀 분석 결과가 오면 보던 위치를 유지한 채 세션만 바꾼다
    const off = window.callpath.onAnalysisEvent((ev) => {
      if (!alive || !same(ev.req)) return;
      if (ev.kind === "status") setPrecise((p) => ({ ...p, message: ev.message }));
      else if (ev.kind === "precise") {
        setPrecise({ running: false, message: null, error: null });
        setAnalysis((a) => (a.status === "ready" && a.session.head === ev.session.head ? { ...a, session: ev.session } : a));
      } else {
        setPrecise({ running: false, message: null, error: ev.error });
      }
    });
    window.callpath.analyze(req).then((r) => {
      if (!alive) return;
      setAnalysis(r.ok ? { status: "ready", session: r.value, run } : { status: "error", message: r.error, kind: r.kind });
      if (!r.ok) setPrecise({ running: false, message: null, error: null });
    });
    return () => {
      alive = false;
      off();
    };
  }, [req, run]);

  const session = analysis.status === "ready" ? analysis.session : null;
  // 메모는 분석에 쓴 커밋(SHA)에 묶는다. 브랜치 이름은 움직이므로 쓰지 않는다
  // 같은 비교의 이전 커밋 메모도 찾으려고 비교 키(PR 주소나 브랜치 이름)를 함께 둔다
  const scope = session ? { repo: req.repo, base: session.base, head: session.head, subject: pr ? pr.url : `${req.base}...${req.head}` } : null;
  const reloadNotes = useCallback(() => {
    if (!scope) return;
    void window.callpath.listNotes(scope).then((r) => {
      if (r.ok) {
        setNotes(r.value);
        setNotesError(null);
      } else setNotesError(`메모를 읽지 못했습니다: ${r.error}`);
    });
  }, [scope?.repo, scope?.base, scope?.head, scope?.subject]);
  const currentNotes = notes.filter((n) => !n.stale);
  const staleCount = notes.length - currentNotes.length;
  const notesToggle = useRef<HTMLButtonElement>(null);
  const closeDrawer = () => {
    setDrawer(false);
    notesToggle.current?.focus();
  };
  // 키 처리 효과가 최신 서랍 상태를 읽게 한다
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;
  const closeDrawerRef = useRef(closeDrawer);
  closeDrawerRef.current = closeDrawer;
  // 좁은 창에서는 서랍이 가운데를 덮으므로, 열린 동안 뒤 영역에는 초점이 가지 않게 한다
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 820px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const panes = [...document.querySelectorAll<HTMLElement>(".panes > .pane")];
    for (const p of panes) p.inert = drawer && narrow;
    return () => {
      for (const p of panes) p.inert = false;
    };
  }, [drawer, narrow, analysis.status]);
  useEffect(() => reloadNotes(), [reloadNotes]);
  const nav = useMemo(() => (session ? buildNav(session, showTests) : null), [session, showTests]);
  const current = nav ? resolveSelection(nav, selectedKey) : null;

  useEffect(() => {
    if (current && current.key !== selectedKey) setSelectedKey(current.key);
  }, [current, selectedKey]);

  useEffect(() => {
    if (current) onPersist(current.key, showTests);
  }, [current?.key, showTests]);

  // 끝에 닿아 누르던 이전, 다음 버튼이 꺼지면 초점이 사라지므로 현재 목록 줄로 옮긴다.
  // 브라우저가 꺼진 버튼의 초점을 언제 거두는지가 환경마다 달라, 화면 갱신 직후와 다음 프레임에 모두 확인한다
  // 하단 버튼으로 옮겼을 때만 복구한다. 다른 이유(테스트 표시 끄기 등)로 위치가 바뀔 때 초점을 끌어오지 않는다
  // 하단 버튼이 옮겨 갈 항목의 키. 그 항목에 도착했을 때만 복구하고, 확인할 때마다 비워 다른 이동에 남지 않게 한다
  const rescueFor = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    const target = rescueFor.current;
    rescueFor.current = null;
    if (target !== current.key) return;
    const rescue = () => {
      const active = document.activeElement as HTMLButtonElement | null;
      if (!active || active === document.body || active.disabled) rows.current.get(current.key)?.focus();
    };
    rescue();
    const id = requestAnimationFrame(rescue);
    return () => cancelAnimationFrame(id);
  }, [current?.key]);

  // 분석 결과를 새로 받으면 선택된 줄로 초점을 옮겨 화면 읽기가 현재 위치부터 읽게 한다.
  // 결과를 받은 실행 번호를 기준으로 삼아, 다시 분석 직후 이전 결과 위에서 먼저 돌지 않고
  // 정밀 분석 결과로 세션만 바뀔 때는 초점을 다시 옮기지 않는다
  const focusedRun = useRef(-1);
  // 다시 분석을 누를 때 초점이 있던 요소. 끝났을 때 초점이 아직 거기 있으면 목록 줄로 옮긴다
  const rerunFrom = useRef<Element | null>(null);
  const rerun = () => {
    rerunFrom.current = document.activeElement;
    setRun((n) => n + 1);
  };
  useEffect(() => {
    if (analysis.status !== "ready" || !current || focusedRun.current === analysis.run) return;
    focusedRun.current = analysis.run;
    // 그사이 사용자가 다른 곳에 초점을 두었으면 빼앗지 않는다. 다시 분석을 누른 자리에 초점이 남아 있으면 옮긴다
    const from = rerunFrom.current;
    rerunFrom.current = null;
    requestAnimationFrame(() => {
      const active = document.activeElement as HTMLButtonElement | null;
      if (!active || active === document.body || active.disabled || (from !== null && active === from)) rows.current.get(current.key)?.focus();
    });
  }, [analysis.status === "ready" ? analysis.run : -1, current?.key]);

  const select = useCallback(
    (item: NavItem | null, remember = true) => {
      if (!item) return;
      if (remember && current && current.key !== item.key) history.current.push(current.key);
      setSelectedKey(item.key);
      // 목록에 초점이 있으면 초점도 따라가서 화면 읽기가 같은 줄을 읽게 한다
      const el = rows.current.get(item.key);
      const listHasFocus = document.activeElement?.closest(".pane.left") != null;
      requestAnimationFrame(() => {
        const row = rows.current.get(item.key) ?? el;
        row?.scrollIntoView({ block: "nearest" });
        if (listHasFocus) row?.focus();
      });
    },
    [current],
  );

  const toggleTests = useCallback(() => setShowTests((v) => !v), []);

  useEffect(() => {
    if (!nav || !current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 게시 미리보기가 열려 있으면 뒤 화면을 움직이지 않는다
      if (document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement;
      if (target.closest("textarea, select, input:not([type=checkbox])")) return;
      if (e.key === "Escape" && drawerRef.current) {
        e.preventDefault();
        closeDrawerRef.current();
        return;
      }
      // 서랍 안에서는 단계 이동 키를 쓰지 않는다(초점이 서랍에 남는다)
      if (target.closest(".drawer")) return;
      const inEditor = target.closest(".monaco-editor") != null;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          if (inEditor && e.key === "ArrowDown") return;
          e.preventDefault();
          select(neighbor(nav, current.key, 1));
          break;
        case "k":
        case "ArrowUp":
          if (inEditor && e.key === "ArrowUp") return;
          e.preventDefault();
          select(neighbor(nav, current.key, -1));
          break;
        case "t":
          e.preventDefault();
          toggleTests();
          break;
        case "m":
          if (noteTarget(current)) {
            e.preventDefault();
            setDrawer(false);
            setNoteRequest((n) => n + 1);
          }
          break;
        case "Enter": {
          // 이미 선택된 목록 줄에서 누른 Enter는 다음 단계로, 다른 버튼에서 누른 Enter는 그 버튼을 누른다
          const row = target.closest<HTMLElement>(".pane.left button.row");
          const onSelectedRow = row?.dataset.key === current.key;
          if (current.kind === "step" && (onSelectedRow || !target.closest("button"))) {
            e.preventDefault();
            select(childSteps(current, nav)[0] ?? null);
          }
          break;
        }
        case "Backspace": {
          e.preventDefault();
          const prev = history.current.pop();
          const item = prev ? nav.order.find((x) => x.key === prev) : undefined;
          if (item) select(item, false);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, current, select, toggleTests]);

  const head = (
    <header className="toolbar">
      <span className="brand">Callpath</span>
      <span className="repo">{repoName}</span>
      {pr ? (
        <span className="refs pr-chip" title={`${pr.title}, ${pr.baseRef} ← ${pr.headRef}`} data-testid="pr-chip">
          #{pr.number} {pr.title}
        </span>
      ) : (
        <span className="refs" title={`기준 ${req.base}, 리뷰할 변경 ${req.head}`} aria-label={`기준 ${req.base}, 리뷰할 변경 ${req.head}`}>
          <span aria-hidden="true">{req.base} ← {req.head}</span>
        </span>
      )}
      {session && <PreciseChip session={session} view={precise} />}
      {session && (
        <span className="stats muted" aria-label="분석 요약">
          흐름 {session.flows.length} · 바뀐 메서드 {session.flows.flatMap((f) => f.steps).filter((s) => s.change !== "unchanged" && !s.refOf).length + session.orphans.length} · {session.stats.ms}ms
        </span>
      )}
      <span className="spacer" />
      {session && (
        <button
          ref={notesToggle}
          onClick={() => setDrawer((v) => !v)}
          aria-expanded={drawer}
          aria-controls="notes-drawer"
          aria-label={`메모 ${currentNotes.length}개${staleCount ? `, 이전 커밋 메모 ${staleCount}개` : ""}`}
          data-testid="notes-toggle"
        >
          메모 {currentNotes.length}
          {staleCount > 0 && <span className="muted small" data-testid="stale-count"> 이전 {staleCount}</span>}
        </button>
      )}
      {pr && <button onClick={() => window.callpath.openExternal(pr.url)} aria-label="PR 페이지를 브라우저로 열기">PR 페이지</button>}
      {pr && <button onClick={onRefreshPr} aria-label="PR을 새로 받기">새로 받기</button>}
      <button onClick={onChangeCompare}>{pr ? "다른 저장소나 PR" : "비교 바꾸기"}</button>
      <button onClick={rerun} disabled={analysis.status === "loading"} aria-label="다시 분석">
        <Icon name="refresh" /> 다시 분석
      </button>
    </header>
  );

  if (analysis.status === "loading") {
    return (
      <div className="review">
        {head}
        <div className="state" role="status" data-testid="state-loading">
          <div className="spinner" aria-hidden="true" />
          <p className="state-title">흐름을 만드는 중</p>
          <p className="muted">바뀐 파일을 읽고 진입점부터 호출을 잇고 있습니다.</p>
        </div>
      </div>
    );
  }
  if (analysis.status === "error") {
    return (
      <div className="review">
        {head}
        <div className="state" role="alert" data-testid="state-error">
          <Icon name="warn" size={28} />
          <h2 className="state-title">분석하지 못했습니다</h2>
          <p className="muted">{analysis.message}</p>
          {analysis.kind === "ref" ? (
            <div className="row">
              <button className="primary" onClick={onChangeCompare} autoFocus>비교 바꾸기</button>
              <button onClick={rerun}>다시 분석</button>
            </div>
          ) : (
            <div className="row">
              <button className="primary" onClick={rerun} autoFocus>다시 분석</button>
              <button onClick={onChangeCompare}>비교 바꾸기</button>
            </div>
          )}
        </div>
      </div>
    );
  }
  // 테스트 코드만 바뀌었는데 테스트를 숨겨 둔 경우: 바뀐 것이 없다고 하지 않고 테스트 표시를 안내한다
  if (!current && session && !showTests && session.otherTests.length > 0) {
    return (
      <div className="review">
        {head}
        <div className="state" data-testid="state-tests-only" role="status">
          <Icon name="test" size={28} />
          <h2 className="state-title">테스트 코드만 바뀌었습니다</h2>
          <p className="muted">숨겨 둔 테스트 파일 {session.otherTests.length}개가 바뀌었습니다.</p>
          <button className="primary" onClick={toggleTests} autoFocus>테스트 표시 켜기</button>
        </div>
      </div>
    );
  }
  if (!nav || !current) {
    return (
      <div className="review">
        {head}
        <div className="state" data-testid="state-empty" role="status">
          <Icon name="nonCode" size={28} />
          <h2 className="state-title">바뀐 파일이 없습니다</h2>
          <p className="muted">기준 <code>{req.base}</code>와 리뷰할 변경 <code>{req.head}</code> 사이에 바뀐 파일이 없습니다.</p>
          <button className="primary" onClick={onChangeCompare} autoFocus>비교 바꾸기</button>
        </div>
      </div>
    );
  }

  const idx = nav.order.findIndex((x) => x.key === current.key);
  const group = nav.groups.find((g) => g.id === current.groupId);
  const position =
    current.kind === "test" ? `${group?.label ?? ""} · 테스트` : `${group?.label ?? ""} · ${current.pos} / ${current.total}`;
  const target = current.kind === "step" ? refTarget(current, nav, session!) : null;
  const refFlow = current.kind === "step" && current.step.refOf ? session!.flows.find((f) => f.id === current.step.refOf!.flow) : undefined;
  const stepForCrumbs: StepItem | null =
    current.kind === "step" ? current : current.kind === "test" ? ((nav.order.find((x) => x.key === current.parentKey) as StepItem | undefined) ?? null) : null;
  const crumbs = stepForCrumbs
    ? { path: stepForCrumbs.step.path.map((p) => shortName(p)), next: childSteps(stepForCrumbs, nav)[0] ? shortName(childSteps(stepForCrumbs, nav)[0]!.step.symbol) : null }
    : null;
  const atEdge = idx === nav.order.length - 1 ? ", 마지막 항목입니다" : idx === 0 ? ", 첫 항목입니다" : "";
  const announce =
    current.kind === "step"
      ? `${position}, ${shortName(current.step.symbol)}, ${CHANGE_LABEL[current.step.change]}${current.step.callOrderDiff?.moved.length ? ", 순서 변경" : ""}`
      : current.kind === "test"
        ? `테스트 ${current.test.symbol.name.replace(/`/g, "")}`
        : `${position}, ${current.file.path}`;

  return (
    <div className="review">
      {head}
      {!bannerClosed && <PreciseBanner session={session!} view={precise} onDismiss={() => setBannerClosed(true)} />}
      <div className={`panes${drawer ? " with-drawer" : ""}`}>
        <FlowList
          nav={nav}
          session={session!}
          selectedKey={current.key}
          showTests={showTests}
          onSelect={(i) => select(i)}
          onToggleTests={toggleTests}
          registerRow={(k, el) => (el ? rows.current.set(k, el) : rows.current.delete(k))}
        />
        <Detail
          item={current}
          session={session!}
          onGoRef={target ? () => select(target) : null}
          refLabel={refFlow && current.kind === "step" ? `${refFlow.label} ${current.step.refOf!.n}단계` : null}
          crumbs={crumbs}
          notes={currentNotes}
          noteRequest={noteRequest}
          reveal={reveal}
          onComposeStart={() => setDrawer(false)}
          onShowNotes={() => setDrawer(true)}
          onAddNote={async (path, line, body) => {
            const r = await window.callpath.addNote(scope!, { path, line, body });
            reloadNotes();
            return r.ok ? null : r.error;
          }}
        />
        {!drawer && <StackPane item={current} nav={nav} onSelect={(i) => select(i)} />}
        {drawer && narrow && <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />}
        {drawer && (
          <div id="notes-drawer" className="drawer-slot">
            <NotesDrawer
              notes={sortByFlow(nav, notes)}
              pr={pr}
              error={notesError}
              onClose={closeDrawer}
              onDelete={(n) =>
                void window.callpath.deleteNote(n.id).then((r) => (r.ok ? reloadNotes() : setNotesError(`메모를 지우지 못했습니다: ${r.error}`)))
              }
              onPost={(ids) => setPosting(ids)}
              onGo={(n) => {
                const hit = findItemFor(nav, n.path, n.line);
                if (!hit) return;
                if (hit.kind === "test" && !showTests) toggleTests();
                select(hit);
                setReveal({ line: n.line, nonce: Date.now() });
                // 넓은 창에서는 서랍이 코드를 덮지 않으므로 열어 두어 메모를 차례로 본다.
                // 좁은 창에서는 코드를 덮으므로 닫고, 초점을 목록의 그 항목으로 옮겨 j, k로 이어 읽게 한다
                if (narrow) {
                  setDrawer(false);
                  requestAnimationFrame(() => requestAnimationFrame(() => (rows.current.get(hit.key) ?? notesToggle.current)?.focus()));
                }
              }}
            />
          </div>
        )}
      </div>
      {posting && pr && <PostDialog pr={pr} ids={posting} onClose={() => setPosting(null)} onPosted={reloadNotes} />}
      <footer className="bottombar">
        <button
          onClick={() => {
            const to = neighbor(nav, current.key, -1);
            rescueFor.current = to?.key ?? null;
            select(to);
          }}
          disabled={idx <= 0}
          aria-label="이전 항목"
        >
          <Icon name="back" /> 이전
        </button>
        <span className="position" data-testid="position">
          <strong>{position}</strong>
          <span className="muted overall"> · 전체 {idx + 1} / {nav.order.length}</span>
        </span>
        <button
          className="primary"
          onClick={() => {
            const to = neighbor(nav, current.key, 1);
            rescueFor.current = to?.key ?? null;
            select(to);
          }}
          disabled={idx >= nav.order.length - 1}
          aria-label="다음 항목"
        >
          다음 <Icon name="next" />
        </button>
        <span className="spacer" />
        <span className="keys muted" aria-hidden="true">
          <kbd>j</kbd>/<kbd>k</kbd> 이동 · <kbd>t</kbd> 테스트<span className="keys-long"> · <kbd>Enter</kbd> 다음 단계 · <kbd>⌫</kbd> 되돌아가기</span>
        </span>
      </footer>
      <div className="sr-only" aria-live="polite" data-testid="announce">{announce}{atEdge}</div>
      <div className="sr-only" aria-live="polite">{session!.analysis.precise === "done" ? "정밀 분석이 끝났습니다" : ""}</div>
    </div>
  );
}
