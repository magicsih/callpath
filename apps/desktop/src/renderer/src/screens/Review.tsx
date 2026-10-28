import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewSession } from "@callpath/core";
import type { CompareRequest, ErrorKind } from "../../../shared/api";
import { childSteps, neighbor, refTarget, resolveSelection, shortName, buildNav, CHANGE_LABEL, type NavItem, type StepItem } from "../nav";
import { FlowList } from "../components/FlowList";
import { Detail } from "../components/Detail";
import { StackPane } from "../components/StackPane";
import { Icon } from "../components/Icon";

type Analysis = { status: "loading" } | { status: "error"; message: string; kind: ErrorKind } | { status: "ready"; session: ReviewSession };

interface Props {
  req: CompareRequest;
  repoName: string;
  initialSelection: string | null;
  initialShowTests: boolean;
  onChangeCompare: () => void;
  onPersist: (selection: string | null, showTests: boolean) => void;
}

export function Review({ req, repoName, initialSelection, initialShowTests, onChangeCompare, onPersist }: Props) {
  const [analysis, setAnalysis] = useState<Analysis>({ status: "loading" });
  const [run, setRun] = useState(0);
  const [showTests, setShowTests] = useState(initialShowTests);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelection);
  const history = useRef<string[]>([]);
  const rows = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    let alive = true;
    setAnalysis({ status: "loading" });
    window.callpath.analyze(req).then((r) => {
      if (!alive) return;
      setAnalysis(r.ok ? { status: "ready", session: r.value } : { status: "error", message: r.error, kind: r.kind });
    });
    return () => {
      alive = false;
    };
  }, [req, run]);

  const session = analysis.status === "ready" ? analysis.session : null;
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

  // 분석이 끝나면 선택된 줄로 초점을 옮겨 화면 읽기가 현재 위치부터 읽게 한다
  const focusedRun = useRef(-1);
  useEffect(() => {
    if (analysis.status !== "ready" || !current || focusedRun.current === run) return;
    focusedRun.current = run;
    // 그사이 사용자가 다른 곳에 초점을 두었으면 빼앗지 않는다
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) rows.current.get(current.key)?.focus();
    });
  }, [analysis.status, current?.key, run]);

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
      const target = e.target as HTMLElement;
      if (target.closest("textarea, select, input:not([type=checkbox])")) return;
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
      <span className="refs" title={`기준 ${req.base}, 리뷰할 변경 ${req.head}`} aria-label={`기준 ${req.base}, 리뷰할 변경 ${req.head}`}>
        <span aria-hidden="true">{req.base} ← {req.head}</span>
      </span>
      {session && (
        <span className="stats muted" aria-label="분석 요약">
          흐름 {session.flows.length} · 바뀐 메서드 {session.flows.flatMap((f) => f.steps).filter((s) => s.change !== "unchanged" && !s.refOf).length + session.orphans.length} · {session.stats.ms}ms
        </span>
      )}
      <span className="spacer" />
      <button onClick={onChangeCompare}>비교 바꾸기</button>
      <button onClick={() => setRun((n) => n + 1)} disabled={analysis.status === "loading"} aria-label="다시 분석">
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
              <button onClick={() => setRun((n) => n + 1)}>다시 분석</button>
            </div>
          ) : (
            <div className="row">
              <button className="primary" onClick={() => setRun((n) => n + 1)} autoFocus>다시 분석</button>
              <button onClick={onChangeCompare}>비교 바꾸기</button>
            </div>
          )}
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
      <div className="panes">
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
        />
        <StackPane item={current} nav={nav} onSelect={(i) => select(i)} />
      </div>
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
    </div>
  );
}
