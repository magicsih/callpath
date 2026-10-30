import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuideProgress, RepoGuide, Tour } from "@callpath/core";
import type { ErrorKind, GuideRequest, GuideTarget, LastGuide } from "../../../shared/api";
import { GuideMap } from "../components/GuideMap";
import { ClassContext, TourSide } from "../components/GuideSide";
import { CodeView } from "../components/CodeView";
import { Icon } from "../components/Icon";
import { languageFor } from "../monaco";
import { Breakable } from "../components/Breakable";
import { ENTRY_KIND_LABEL, KIND_LABEL, branchText, childSteps, implementors, stepAt, stepName, topClasses, tourMarks } from "../guideNav";

type Load =
  | { status: "loading"; progress: GuideProgress | null }
  | { status: "error"; message: string; kind: ErrorKind }
  | { status: "large"; files: number; dirs: Array<{ path: string; files: number }> }
  | { status: "ready"; guide: RepoGuide; cached: boolean };

type TourState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; tour: Tour };
type View = LastGuide["view"];

function progressText(p: GuideProgress | null): string {
  if (!p) return "저장소를 읽는 중";
  if (p.stage === "read") return `파일 읽는 중 ${p.done} / ${p.total} (테스트 포함)`;
  return p.stage === "link" ? "호출을 잇는 중" : "지도를 만드는 중";
}

interface Props {
  req: GuideRequest;
  repoName: string;
  /** 같은 브랜치와 디렉터리를 마지막에 보던 자리 */
  initial: LastGuide | null;
  onBack: () => void;
  /** 큰 저장소에서 디렉터리로 좁히거나(dir) 전체를 둘러본다(force) */
  /** draft는 "다른 디렉터리 고르기"로 돌아갈 때 입력칸에 남길 값 */
  onNarrow: (dir: string | null, force: boolean, draft?: string) => void;
  /** 큰 저장소 안내의 디렉터리 입력칸 처음 값 */
  initialDir?: string;
  onPersist: (place: Pick<LastGuide, "view" | "classId" | "entryId" | "step">) => void;
}

export function Guide({ req, repoName, initial, onBack, onNarrow, onPersist, initialDir }: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading", progress: null });
  const [run, setRun] = useState(0);
  const [view, setView] = useState<View>(initial?.view ?? "map");
  const [classId, setClassId] = useState<string | null>(initial?.classId ?? null);
  const [codeOf, setCodeOf] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(initial?.entryId ?? null);
  const [step, setStep] = useState<number>(initial?.step ?? 1);
  const [tours, setTours] = useState<Record<string, TourState>>({});
  const [through, setThrough] = useState<Record<string, string[] | { error: string }>>({});
  const [files, setFiles] = useState<Record<string, string | { error: string }>>({});
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number; pkg?: string } | null>(null);
  const stateTitle = useRef<HTMLHeadingElement>(null);
  const [dirInput, setDirInput] = useState(initialDir ?? "");
  // 맥락 목록에서 마우스나 초점이 놓인 클래스. 지도에서 그 선만 진하게 그린다
  const [emphasis, setEmphasis] = useState<string | null>(null);
  const codeBack = useRef<HTMLButtonElement>(null);
  const history = useRef<number[]>([]);
  const stepRows = useRef(new Map<number, HTMLButtonElement>());
  const tabs = useRef(new Map<View, HTMLButtonElement>());

  useEffect(() => {
    let alive = true;
    setLoad({ status: "loading", progress: null });
    const same = (r: GuideRequest) => r.repo === req.repo && r.ref === req.ref && (r.dir ?? null) === (req.dir ?? null) && !!r.force === !!req.force;
    const off = window.callpath.onGuideProgress((ev) => {
      if (alive && same(ev.req)) setLoad((l) => (l.status === "loading" ? { status: "loading", progress: ev.progress } : l));
    });
    void window.callpath.guide(req).then((r) => {
      if (!alive) return;
      if (!r.ok) setLoad({ status: "error", message: r.error, kind: r.kind });
      else if (r.value.status === "large") setLoad({ status: "large", files: r.value.files, dirs: r.value.dirs });
      else setLoad({ status: "ready", guide: r.value.guide, cached: r.value.cached });
    });
    return () => {
      alive = false;
      off();
    };
  }, [req, run]);

  const guide = load.status === "ready" ? load.guide : null;
  const target: GuideTarget | null = guide ? { repo: req.repo, sha: guide.sha, dir: guide.dir } : null;
  const byId = useMemo(() => new Map(guide?.classes.map((c) => [c.id, c]) ?? []), [guide]);

  // 저장해 둔 자리가 이 커밋에 없으면(클래스가 사라짐 등) 처음 자리로 돌린다
  useEffect(() => {
    if (!guide) return;
    if (classId && !byId.has(classId)) setClassId(null);
    if (entryId && !guide.entries.some((e) => e.id === entryId)) {
      setEntryId(null);
      setStep(1);
    }
  }, [guide]);

  const tourState = entryId ? tours[entryId] : undefined;
  const tour = tourState?.status === "ready" ? tourState.tour : null;
  useEffect(() => {
    if (!target || !entryId || tours[entryId]) return;
    setTours((m) => ({ ...m, [entryId]: { status: "loading" } }));
    void window.callpath.tour(target, entryId).then((r) => {
      setTours((m) => ({ ...m, [entryId]: r.ok ? { status: "ready", tour: r.value } : { status: "error", message: r.error } }));
    });
  }, [target?.sha, entryId, tours]);
  useEffect(() => {
    if (tour && step > tour.steps.length) setStep(1);
  }, [tour]);

  useEffect(() => {
    if (!target || !classId || through[classId]) return;
    void window.callpath.entriesThrough(target, classId).then((r) => setThrough((m) => ({ ...m, [classId]: r.ok ? r.value : { error: r.error } })));
  }, [target?.sha, classId, through]);

  useEffect(() => {
    if (guide) onPersist({ view, classId, entryId, step });
  }, [guide, view, classId, entryId, step]);

  const readFile = useCallback(
    (path: string) => {
      if (!guide || files[path]) return;
      setFiles((m) => ({ ...m, [path]: { error: "" } }));
      void window.callpath.readFile({ repo: req.repo, ref: guide.sha, path }).then((r) => {
        setFiles((m) => ({ ...m, [path]: r.ok ? (r.value ?? { error: "이 커밋에 파일이 없습니다." }) : { error: r.error } }));
      });
    },
    [guide, files, req.repo],
  );
  const currentStep = tour ? stepAt(tour, step) : null;
  const codePath = view === "tour" ? currentStep?.symbol.path : codeOf ? byId.get(codeOf)?.path : undefined;
  useEffect(() => {
    if (codePath) readFile(codePath);
  }, [codePath, readFile]);

  const goStep = useCallback(
    (n: number, remember = true) => {
      if (!tour || n < 1 || n > tour.steps.length || n === step) return;
      if (remember) history.current.push(step);
      setStep(n);
    },
    [tour, step],
  );
  // 지도에서 고른 클래스가 나오는 단계와, 투어가 열리면 단계 줄로 초점을 옮길지. 투어를 아직 모르면 받은 뒤 처리한다
  const pendingClass = useRef<string | null>(null);
  const focusStep = useRef(false);
  // 같은 진입점의 투어가 이미 열려 있어도 클래스 단계로 옮기도록 시작할 때마다 바꾼다
  const [startNonce, setStartNonce] = useState(0);
  const startTour = useCallback((id: string, atClass: string | null, moveFocus = true) => {
    setEntryId(id);
    setView("tour");
    setCodeOf(null);
    history.current = [];
    setStep(1);
    pendingClass.current = atClass;
    focusStep.current = moveFocus;
    setStartNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!tour || !pendingClass.current || !guide || tour.entry.id !== entryId) return;
    // 이 클래스가 단계로 나오는 곳, 없으면 접은 메서드로 나오는 단계, 인터페이스면 구현 클래스가 나오는 단계
    const id = pendingClass.current;
    const family = new Set([id, ...implementors(guide, id).map((c) => c.id)]);
    const s =
      tour.steps.find((x) => family.has(x.classId)) ?? tour.steps.find((x) => [...x.folded, ...x.external].some((f) => family.has(f.classId)));
    pendingClass.current = null;
    if (s) setStep(s.n);
  }, [tour, startNonce]);

  const showOnMap = useCallback((id: string) => {
    setView("map");
    setCodeOf(null);
    if (id) {
      setClassId(id);
      setFocusRequest({ id, nonce: Date.now() });
    }
  }, []);

  // 지도나 진입점 목록에서 투어를 열면 고른 단계 줄로 초점을 옮겨 j/k와 화면 읽기가 그 자리에서 시작하게 한다.
  // 탭에서 화살표로 넘어온 것이면 초점을 탭에 둔다
  useEffect(() => {
    if (view !== "tour" || !tour || !focusStep.current || pendingClass.current) return;
    focusStep.current = false;
    // 단계 줄이 그려진 다음 프레임에 옮긴다(같은 진입점에서 단계만 바뀔 때 줄이 아직 없을 수 있다)
    requestAnimationFrame(() => stepRows.current.get(step)?.focus());
  }, [view, tour, step, startNonce]);

  // 코드를 열면 "지도로" 단추로 초점을 옮겨 Escape나 Enter로 바로 돌아갈 수 있게 한다
  useEffect(() => {
    if (codeOf) codeBack.current?.focus();
  }, [codeOf]);

  // 지도나 투어가 처음 뜨면, 초점이 아무 데도 없을 때만 고른 칩이나 단계 줄로 옮긴다
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!guide || focusedOnce.current) return;
    focusedOnce.current = true;
    const id = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (view === "tour") stepRows.current.get(step)?.focus();
      else document.querySelector<HTMLElement>('[data-testid="map-chip"][tabindex="0"]')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [guide, tour]);

  useEffect(() => {
    if (!guide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement;
      if (t.closest("textarea, select, input")) return;
      const inEditor = t.closest(".monaco-editor") != null;
      if (view === "map") {
        if (e.key === "Escape" && codeOf) {
          e.preventDefault();
          const back = codeOf;
          setCodeOf(null);
          setFocusRequest({ id: back, nonce: Date.now() });
        }
        return;
      }
      if (!tour) return;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          if ((inEditor || t.closest("[role=tab]")) && e.key === "ArrowDown") return;
          e.preventDefault();
          goStep(step + 1);
          break;
        case "k":
        case "ArrowUp":
          if ((inEditor || t.closest("[role=tab]")) && e.key === "ArrowUp") return;
          e.preventDefault();
          goStep(step - 1);
          break;
        case "Enter": {
          // 단계 줄이나 빈 곳에서 누른 Enter는 이어지는 단계로, 다른 버튼에서 누른 Enter는 그 버튼을 누른다
          const row = t.closest<HTMLElement>("[data-step]");
          if (row ? Number(row.dataset.step) === step : !t.closest("button, a")) {
            const next = childSteps(tour, step)[0];
            if (next) {
              e.preventDefault();
              goStep(next.step.n);
            }
          }
          break;
        }
        case "Backspace": {
          e.preventDefault();
          const prev = history.current.pop();
          if (prev) goStep(prev, false);
          break;
        }
      }
    };
    // 읽기 전용 편집기가 Backspace를 먼저 삼키지 않게 잡기 단계에서 받는다
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [guide, view, tour, step, codeOf, goStep]);

  // 단계를 옮기면 목록을 따라 내리고, 초점이 단계 줄에 있었으면 새 단계 줄로 옮긴다(다음 Enter가 옛 줄을 누르지 않게)
  useEffect(() => {
    if (view !== "tour") return;
    const row = stepRows.current.get(step);
    row?.scrollIntoView({ block: "nearest" });
    const active = document.activeElement as HTMLElement | null;
    if (row && active?.dataset.step && active !== row) row.focus();
  }, [step, view]);

  // 지도는 가로 폭이 필요해 1100px 이하에서 맥락을 지도 아래로 내린다. 투어는 리뷰 화면처럼 820px 이하에서 내린다
  const useNarrow = (query: string) => {
    const [m, setM] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
      const mq = window.matchMedia(query);
      const on = () => setM(mq.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    }, [query]);
    return m;
  };
  const narrowMap = useNarrow("(max-width: 1100px)");
  const narrowTour = useNarrow("(max-width: 820px)");

  // 오류와 큰 저장소 안내가 뜨면 제목으로 초점을 옮겨 화면 읽기가 이유부터 읽게 한다
  useEffect(() => {
    if (load.status === "error" || load.status === "large") stateTitle.current?.focus();
  }, [load.status]);

  if (load.status === "loading") {
    return (
      <main className="state" aria-busy="true" data-testid="guide-loading">
        <div className="spinner" aria-hidden="true" />
        <p className="state-title" role="status">{progressText(load.progress)}</p>
        <p className="muted">{repoName} {req.ref}{req.dir ? `, ${req.dir}` : ""}</p>
        <button onClick={onBack}>비교로</button>
      </main>
    );
  }
  if (load.status === "error") {
    return (
      <main className="state" data-testid="guide-error">
        <h1 className="state-title" tabIndex={-1} ref={stateTitle}><Icon name="warn" /> 둘러보지 못했습니다</h1>
        <p className="muted" role="alert">{load.message}</p>
        <p className="muted small">{repoName} {req.ref}{req.dir ? `, ${req.dir}` : ""}</p>
        <div className="row">
          {req.dir && <button className="primary" onClick={() => onNarrow(null, false, req.dir)}>다른 디렉터리 고르기</button>}
          {load.kind !== "ref" && !req.dir && <button className="primary" onClick={() => setRun((n) => n + 1)}>다시 시도</button>}
          <button className={load.kind === "ref" ? "primary" : ""} onClick={onBack}>{load.kind === "ref" ? "브랜치 다시 고르기" : "비교로"}</button>
        </div>
      </main>
    );
  }
  if (load.status === "large") {
    return (
      <main className="state large" data-testid="guide-large">
        <h1 className="state-title" tabIndex={-1} ref={stateTitle}>코드 파일이 {load.files.toLocaleString()}개입니다</h1>
        <p className="muted small">{repoName} {req.ref}</p>
        <p className="muted">3,000개가 넘으면 처음 분석이 오래 걸릴 수 있습니다. 디렉터리 하나로 좁혀 둘러보거나 전체를 둘러보세요.</p>
        <ul className="dir-list">
          {load.dirs.map((d) => (
            <li key={d.path}>
              <button onClick={() => onNarrow(d.path, false)}>
                <Icon name="folder" /> <span className="dir-path">{d.path}</span> <span className="dim">파일 {d.files.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirInput.trim()) onNarrow(dirInput.trim(), false);
          }}
        >
          <label htmlFor="guide-dir">다른 디렉터리</label>
          <input id="guide-dir" value={dirInput} onChange={(e) => setDirInput(e.target.value)} placeholder="예: services/order" />
          <button type="submit" disabled={!dirInput.trim()}>좁혀 둘러보기</button>
        </form>
        <div className="row">
          <button onClick={() => onNarrow(null, true)}>전체 둘러보기</button>
          <button onClick={onBack}>비교로</button>
        </div>
      </main>
    );
  }

  const g = load.guide;
  const selected = classId ? byId.get(classId) ?? null : null;
  const codeNode = codeOf ? byId.get(codeOf) ?? null : null;
  const file = codePath ? files[codePath] : undefined;
  const throughOf = classId ? through[classId] : undefined;

  const switchView = (v: View) => {
    // 지도가 다시 붙을 때 지난 초점 요청으로 초점을 칩에 빼앗기지 않게 비운다
    setFocusRequest(null);
    setView(v);
    if (v === "tour" && !entryId && g.entries[0]) startTour(g.entries[0].id, null, false);
  };

  const tabList = (
    <div className="view-tabs" role="tablist" aria-label="보기">
      {(["map", "tour"] as const).map((v) => (
        <button
          key={v}
          role="tab"
          id={`tab-${v}`}
          ref={(el) => void (el ? tabs.current.set(v, el) : tabs.current.delete(v))}
          aria-selected={view === v}
          aria-controls={`panel-${v}`}
          tabIndex={view === v ? 0 : -1}
          className={view === v ? "selected" : ""}
          onClick={() => switchView(v)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = v === "map" ? "tour" : "map";
            switchView(next);
            tabs.current.get(next)?.focus();
          }}
        >
          {v === "map" ? "지도" : "투어"}
        </button>
      ))}
    </div>
  );

  const mapLeft = (
    <div className="list-scroll" id="panel-map" role="tabpanel" aria-labelledby="tab-map">
      <button className="skip-link" onClick={() => setFocusRequest({ id: classId ?? g.packages.find((p) => p.classIds.length)?.classIds[0] ?? "", nonce: Date.now() })}>
        지도 칩으로 바로 가기
      </button>
      <h2 className="group-title"><span className="glabel">패키지 {g.packages.length}</span></h2>
      <ul className="side-list" data-testid="package-list">
        {g.packages.map((p) => (
          <li key={p.name}>
            <button
              className="side-row"
              title={p.name || "(기본 패키지)"}
              onClick={() => {
                setCodeOf(null);
                const first = p.classIds[0];
                if (first) setFocusRequest({ id: first, nonce: Date.now(), pkg: p.name });
              }}
            >
              <span className="name">{p.label}</span>
              <span className="dim" title={`파일 ${p.files}, 클래스 ${p.classIds.length}`}>{p.files}</span>
            </button>
          </li>
        ))}
      </ul>
      {topClasses(g).length > 0 && (
        <>
          <h2 className="group-title"><span className="glabel">많이 쓰이는 클래스</span></h2>
          <p className="dim side-note">다른 패키지에서 부르는 수. 이름으로만 이은 호출은 0.5로 셉니다.</p>
          <ul className="side-list" data-testid="top-classes">
            {topClasses(g).map((c) => (
              <li key={c.id}>
                <button
                  className={`side-row${c.id === classId ? " selected" : ""}`}
                  title={`${c.id}, 다른 패키지에서 ${c.fanIn}번 부름`}
                  onClick={() => {
                    setCodeOf(null);
                    setClassId(c.id);
                    setFocusRequest({ id: c.id, nonce: Date.now() });
                  }}
                >
                  <span className="name">{c.name}{topClasses(g).filter((x) => x.name === c.name).length > 1 && <span className="dim"> {g.packages.find((p) => p.name === c.packageName)?.label}</span>}</span>
                  <span className="dim">{c.fanIn}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  const tourLeft = (
    <div className="list-scroll" id="panel-tour" role="tabpanel" aria-labelledby="tab-tour">
      {g.noEntries && g.entries.length > 0 && (
        <p className="notice small" data-testid="no-entries"><Icon name="warn" /> 진입점 규칙에 맞는 메서드가 없어 다른 패키지에서 많이 부르는 공개 메서드로 대신합니다.</p>
      )}
      {g.entries.length === 0 && <p className="placeholder">투어를 시작할 진입점이 없습니다. 진입점 규칙은 <code>.callpath.yml</code>의 entries로 더할 수 있습니다.</p>}
      <ul className="entry-list" data-testid="entry-list">
        {g.entries.map((e) => {
          const open = e.id === entryId;
          const st = tours[e.id];
          return (
            <li key={e.id}>
              <button className={`side-row entry${open ? " selected" : ""}`} aria-expanded={open} onClick={() => (open ? undefined : startTour(e.id, null))} data-testid="entry-row">
                <Icon name={e.kind === "api" ? "link" : e.kind} />
                <span className="name" title={`${ENTRY_KIND_LABEL[e.kind]} ${e.label}`}><Breakable text={e.label} /></span>
                {st?.status === "ready" && <span className="dim" title={`${st.tour.steps.length}단계`}>{st.tour.steps.length}<span className="sr-only">단계</span></span>}
              </button>
              {open && st?.status === "loading" && <p className="muted small step-note" role="status">투어를 만드는 중</p>}
              {open && st?.status === "error" && <p className="error-text small step-note"><Icon name="warn" /> {st.message}</p>}
              {open && st?.status === "ready" && (
                <ol className="tour-steps" aria-label={`${e.label} 단계`}>
                  {st.tour.steps.map((s) => (
                    <li key={s.n}>
                      <button
                        ref={(el) => void (el ? stepRows.current.set(s.n, el) : stepRows.current.delete(s.n))}
                        className={`side-row step${s.n === step ? " selected" : ""}`}
                        aria-current={s.n === step ? "step" : undefined}
                        data-step={s.n}
                        data-testid="tour-step"
                        style={{ paddingLeft: `${16 + Math.min(s.depth, 4) * 10}px` }}
                        onClick={() => goStep(s.n)}
                      >
                        <span className="num">{s.n}</span>
                        <span className="name" title={s.symbol.qualifiedName}><Breakable text={stepName(st.tour, s)} /></span>
                        {branchText(s, false) && <span className="flag ref" title={branchText(s, true)!}>{branchText(s, false)}</span>}
                      </button>
                    </li>
                  ))}
                  {(st.tour.collapsed > 0 || st.tour.truncated) && (
                    <li className="muted small step-note">
                      {st.tour.collapsed > 0 && `접은 메서드 ${st.tour.collapsed}개`}
                      {st.tour.collapsed > 0 && st.tour.truncated && ", "}
                      {st.tour.truncated && "깊이나 단계 상한에서 잘린 가지가 있음"}
                    </li>
                  )}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  const fileText = typeof file === "string" ? file : null;
  const fileError = file && typeof file !== "string" && file.error ? file.error : null;
  const mapCenter = codeNode ? (
    <>
      <div className="detail-head">
        <div className="title-row">
          <button ref={codeBack} onClick={() => showOnMap(codeNode.id)} data-testid="back-to-map"><Icon name="back" /> 지도로</button>
          <h2 title={codeNode.id}>{codeNode.name}</h2>
          <span className="chip">{KIND_LABEL[codeNode.kind]}</span>
        </div>
        <p className="muted path">{codeNode.path}</p>
      </div>
      <div className="diff-wrap">
        {fileError ? (
          <p className="placeholder error-text"><Icon name="warn" /> {fileError}</p>
        ) : fileText === null ? (
          <p className="placeholder" role="status">코드를 읽는 중</p>
        ) : (
          <CodeView
            text={fileText}
            language={languageFor(codeNode.path)}
            firstLine={1}
            reveal={codeNode.range.startLine + 1}
            highlight={{ from: codeNode.range.startLine + 1, to: codeNode.range.endLine + 1 }}
            marks={[]}
            label={`${codeNode.name} 코드`}
          />
        )}
      </div>
    </>
  ) : (
    <>
      <GuideMap guide={g} selected={classId} onSelect={setClassId} onOpen={(id) => setCodeOf(id)} focusRequest={focusRequest} emphasis={emphasis} />
    </>
  );

  const s = currentStep;
  const tourCenter = !entryId ? (
    <p className="placeholder">{g.entries.length ? "왼쪽에서 진입점을 고르세요." : "투어를 시작할 진입점이 없습니다."}</p>
  ) : !tour || !s ? (
    <p className="placeholder" role="status">{tourState?.status === "error" ? tourState.message : "투어를 만드는 중"}</p>
  ) : (
    <>
      <div className="detail-head">
        <div className="title-row">
          <span className="num">{s.n}</span>
          <h2 title={s.symbol.qualifiedName} data-testid="step-title">{stepName(tour, s)}</h2>
          {branchText(s, true) && <span className="flag ref">{branchText(s, true)}</span>}
          {s.confidence === "low" && <span className="flag low">연결 불확실</span>}
        </div>
        <p className="muted path">{s.symbol.path}</p>
        {s.abstract && <p className="small muted">본문이 없는 추상 메서드입니다. 저장소 안에 구현이 없어 실제 동작은 저장소 밖(프레임워크, 라이브러리, 다른 서비스)에 있습니다.</p>}
      </div>
      <div className="diff-wrap">
        {fileError ? (
          <p className="placeholder error-text"><Icon name="warn" /> {fileError}</p>
        ) : fileText === null ? (
          <p className="placeholder" role="status">코드를 읽는 중</p>
        ) : (
          <CodeView
            text={fileText.split("\n").slice(s.symbol.range.startLine, s.symbol.range.endLine + 1).join("\n")}
            language={languageFor(s.symbol.path)}
            firstLine={s.symbol.range.startLine + 1}
            reveal={null}
            highlight={null}
            marks={tourMarks(tour, s.n)}
            label={`${s.n}단계 ${stepName(tour, s)} 코드`}
            onMarkClick={(to) => goStep(to)}
          />
        )}
      </div>
    </>
  );

  const entry = entryId ? g.entries.find((e) => e.id === entryId) : undefined;
  const nextEntry = entry ? g.entries[g.entries.indexOf(entry) + 1] ?? null : null;
  const side =
    view === "map" ? (
      <ClassContext
        guide={g}
        node={selected}
        through={Array.isArray(throughOf) ? throughOf : null}
        throughError={throughOf && !Array.isArray(throughOf) ? throughOf.error : null}
        onSelect={(id) => {
          setCodeOf(null);
          setClassId(id);
          setFocusRequest({ id, nonce: Date.now() });
        }}
        onOpenCode={(id) => setCodeOf(id)}
        onStartTour={startTour}
        onEmphasis={setEmphasis}
      />
    ) : tour ? (
      <TourSide tour={tour} n={step} onStep={(n) => goStep(n)} onShowOnMap={showOnMap} nextEntry={nextEntry} onNextEntry={() => nextEntry && startTour(nextEntry.id, null)} />
    ) : null;

  const narrow = view === "map" ? narrowMap : narrowTour;
  // 지도 보기의 좁은 창에서는 클래스를 골랐을 때만 맥락을 지도 아래에 보인다
  const showNarrowSide = narrow && side && (view === "tour" || selected !== null);
  const st = g.stats;
  return (
    <div className="review guide" data-testid="guide" data-cached={load.cached}>
      <header className="toolbar">
        <span className="brand">Callpath</span>
        <span className="repo">{repoName}</span>
        <span className="refs" title={`${req.ref}, 커밋 ${g.sha}${g.dir ? `, ${g.dir}` : ""}`} data-testid="guide-ref">
          {req.ref}@{g.sha.slice(0, 7)}{g.dir ? ` ${g.dir}` : ""}
        </span>
        <span className="stats muted">
          파일 {st.files}, 클래스 {st.classes}, {g.noEntries ? `공개 API ${g.entries.length}` : `진입점 ${st.entries}`}
        </span>
        <span className="spacer" />
        {g.dir && <button onClick={() => onNarrow(null, true)}>저장소 전체로</button>}
        {!g.dir && req.force && <button onClick={() => onNarrow(null, false)}>디렉터리로 좁히기</button>}
        <button onClick={() => setRun((n) => n + 1)} title="브랜치가 새 커밋을 가리키면 그 커밋으로 다시 둘러봅니다"><Icon name="refresh" /> 다시 분석</button>
        <button onClick={onBack}>비교로</button>
      </header>
      <div className={`panes view-${view}${narrow ? " no-right" : ""}`}>
        <nav className="pane left" aria-label={view === "map" ? "패키지" : "진입점과 단계"}>
          {tabList}
          {view === "map" ? mapLeft : tourLeft}
        </nav>
        <main className="pane center">
          {view === "map" ? mapCenter : tourCenter}
          {showNarrowSide && <section className="narrow-side" aria-label={view === "map" ? "맥락" : "호출 스택"}>{side}</section>}
        </main>
        {!narrow && <aside className="pane right" aria-label={view === "map" ? "맥락" : "호출 스택"}>{side}</aside>}
      </div>
      {view === "tour" && tour && (
        <footer className="bottombar">
          <button onClick={() => goStep(step - 1)} disabled={step <= 1}><Icon name="back" /> 이전</button>
          <span className="position" aria-live="polite">{entry?.label} {step} / {tour.steps.length}{step === tour.steps.length ? ", 마지막 단계" : ""}</span>
          <button onClick={() => goStep(step + 1)} disabled={step >= tour.steps.length}>다음 <Icon name="next" /></button>
          <span className="spacer" />
          <span className="keys muted"><kbd>j</kbd>/<kbd>k</kbd> 이동 <kbd>Enter</kbd> 다음 <kbd>⌫</kbd> 뒤로</span>
        </footer>
      )}
    </div>
  );
}
