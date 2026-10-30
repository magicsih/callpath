import { useCallback, useEffect, useRef, useState } from "react";
import type { CompareRequest, ConnectionHint, GuideRequest, PrMeta, RepoInfo, UiState } from "../../shared/api";
import { EMPTY_STATE } from "../../shared/api";
import { Start } from "./screens/Start";
import { Compare } from "./screens/Compare";
import { Review } from "./screens/Review";
import { Guide } from "./screens/Guide";
import { Connections } from "./screens/Connections";
import { PrOpening } from "./screens/PrOpening";
import { LlmSettings } from "./screens/LlmSettings";
import type { SavedAnswer } from "./components/Explain";

type Screen =
  | { name: "boot" }
  | { name: "start"; error: string | null; prError?: { url: string; message: string } }
  | { name: "compare"; repo: RepoInfo; base?: string; head?: string; guideRef?: string }
  | { name: "review"; repo: RepoInfo; req: CompareRequest; selection: string | null; showTests: boolean; pr: PrMeta | null }
  | { name: "guide"; repo: RepoInfo; req: GuideRequest; dirDraft?: string }
  | { name: "connections"; back: Screen; hint?: ConnectionHint }
  | { name: "llm"; back: Screen }
  | { name: "pr"; url: string; back: Screen };

/** PR 리뷰는 앱 캐시의 bare 저장소를 쓰므로 그 경로로 화면용 저장소 정보를 만든다 */
function prRepo(m: PrMeta): RepoInfo {
  return { path: m.gitDir, name: m.repo.split("/").pop() ?? m.repo, branches: [], defaultBase: null, current: null, hasCommits: true, branchError: null };
}

export function App() {
  // LLM 답은 리뷰 화면이 다시 그려져도(설정을 다녀와도) 남게 여기 둔다. 키에 커밋 SHA가 들어가 다른 커밋과 섞이지 않는다
  const answers = useRef<Record<string, SavedAnswer>>({});
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [busy, setBusy] = useState(false);
  const state = useRef<UiState>(EMPTY_STATE);
  const [recent, setRecent] = useState<string[]>([]);
  const [recentPrs, setRecentPrs] = useState<UiState["recentPrs"]>([]);

  const persist = useCallback((next: UiState) => {
    state.current = next;
    setRecent(next.recent);
    setRecentPrs(next.recentPrs);
    void window.callpath.saveState(next);
  }, []);

  // 마지막으로 보던 리뷰가 있으면 그 자리로 돌아간다
  useEffect(() => {
    void (async () => {
      const s = await window.callpath.loadState();
      state.current = s;
      setRecent(s.recent);
      setRecentPrs(s.recentPrs);
      // 마지막에 둘러보던 저장소면 둘러보기로 돌아간다
      const lastGuide = s.lastRepo && s.lastView === "guide" ? s.guides[s.lastRepo] : undefined;
      if (s.lastRepo && lastGuide) {
        const r = await window.callpath.inspectRepo(s.lastRepo);
        if (r.ok) {
          setScreen({
            name: "guide", repo: r.value,
            req: { repo: r.value.path, ref: lastGuide.ref, ...(lastGuide.dir ? { dir: lastGuide.dir } : {}), ...(lastGuide.force ? { force: true } : {}) },
          });
          return;
        }
        setScreen({ name: "start", error: `마지막 저장소를 열 수 없습니다: ${r.error}` });
        return;
      }
      const last = s.lastRepo ? s.repos[s.lastRepo] : undefined;
      // PR 리뷰는 받아 둔 코드와 PR 정보로 네트워크 없이 바로 복원한다. 새 커밋은 "새로 받기"로 확인한다
      const lastPr = s.lastRepo ? s.prs[s.lastRepo] : undefined;
      if (lastPr) {
        setScreen({
          name: "review", repo: prRepo(lastPr), req: { repo: lastPr.gitDir, base: lastPr.baseSha, head: lastPr.headSha },
          selection: last?.selection ?? null, showTests: last?.showTests ?? false, pr: lastPr,
        });
        return;
      }
      if (last) {
        const r = await window.callpath.inspectRepo(last.repo);
        if (r.ok) {
          setScreen({ name: "review", repo: r.value, req: { repo: r.value.path, base: last.base, head: last.head }, selection: last.selection, showTests: last.showTests, pr: null });
          return;
        }
        setScreen({ name: "start", error: `마지막 저장소를 열 수 없습니다: ${r.error}` });
        return;
      }
      setScreen({ name: "start", error: null });
    })();
  }, []);

  const open = useCallback(
    async (path: string) => {
      setBusy(true);
      const r = await window.callpath.inspectRepo(path);
      setBusy(false);
      if (!r.ok) {
        setScreen({ name: "start", error: r.error });
        return;
      }
      persist({ ...state.current, recent: [r.value.path, ...state.current.recent.filter((p) => p !== r.value.path)].slice(0, 10) });
      // 저장소마다 마지막으로 고른 비교를 기본값으로 채운다
      const remembered = state.current.repos[r.value.path];
      setScreen({ name: "compare", repo: r.value, ...(remembered ? { base: remembered.base, head: remembered.head } : {}) });
    },
    [persist],
  );

  const prOpened = useCallback(
    (m: PrMeta) => {
      const req = { repo: m.gitDir, base: m.baseSha, head: m.headSha };
      const remembered = state.current.repos[m.gitDir];
      const same = remembered !== undefined && remembered.base === req.base && remembered.head === req.head;
      const selection = same ? remembered.selection : null;
      const showTests = remembered?.showTests ?? false;
      persist({
        ...state.current,
        lastRepo: m.gitDir,
        lastView: "review",
        repos: { ...state.current.repos, [m.gitDir]: { ...req, selection, showTests } },
        prs: { ...state.current.prs, [m.gitDir]: m },
        recentPrs: [{ url: m.url, title: `#${m.number} ${m.title}` }, ...state.current.recentPrs.filter((p) => p.url !== m.url)].slice(0, 10),
      });
      setScreen({ name: "review", repo: prRepo(m), req, selection, showTests, pr: m });
    },
    [persist],
  );

  /** 둘러보기를 연다. 같은 브랜치와 디렉터리면 마지막에 보던 자리를 이어간다. 저장은 지도가 열린 뒤에 한다(실패한 둘러보기로 다시 열리지 않게) */
  const openGuide = useCallback(
    (repo: RepoInfo, req: GuideRequest, dirDraft?: string) => setScreen({ name: "guide", repo, req, ...(dirDraft ? { dirDraft } : {}) }),
    [],
  );

  const pick = useCallback(async () => {
    const path = await window.callpath.pickFolder();
    if (path) await open(path);
  }, [open]);

  if (screen.name === "boot") return <div className="state" role="status">불러오는 중</div>;
  // 리뷰에서 온 LLM 설정은 아래에서 리뷰를 숨긴 채 그대로 두고 보인다(분석, 코드 위치, 받은 답을 지킨다)
  if (screen.name === "llm" && screen.back.name !== "review" && screen.back.name !== "guide") return <LlmSettings onBack={() => setScreen(screen.back)} />;
  if (screen.name === "connections") {
    // PR 열기에서 왔으면 돌아갈 때 그 PR을 이어서 연다는 것을 버튼에 적는다
    return <Connections onBack={() => setScreen(screen.back)} backLabel={screen.back.name === "pr" ? "돌아가서 PR 다시 열기" : "돌아가기"} {...(screen.hint ? { hint: screen.hint } : {})} />;
  }
  if (screen.name === "pr") {
    return (
      <PrOpening
        url={screen.url}
        onOpened={prOpened}
        onBack={() => setScreen(screen.back)}
        onConnections={(hint) => setScreen({ name: "connections", back: screen, ...(hint ? { hint } : {}) })}
        onInvalid={(message) => setScreen({ name: "start", error: null, prError: { url: screen.url, message } })}
      />
    );
  }
  if (screen.name === "start") {
    return (
      <Start
        recent={recent}
        recentPrs={recentPrs}
        error={screen.error}
        prError={screen.prError}
        busy={busy}
        onOpen={open}
        onPick={pick}
        onOpenPr={(url) => setScreen({ name: "pr", url, back: screen })}
        onConnections={() => setScreen({ name: "connections", back: screen })}
        onLlmSettings={() => setScreen({ name: "llm", back: screen })}
      />
    );
  }
  if (screen.name === "compare") {
    return (
      <Compare
        repo={screen.repo}
        {...(screen.base ? { initialBase: screen.base } : {})}
        {...(screen.head ? { initialHead: screen.head } : {})}
        {...(screen.guideRef ? { initialGuideRef: screen.guideRef } : {})}
        onBack={() => {
          persist({ ...state.current, lastRepo: null });
          setScreen({ name: "start", error: null });
        }}
        onReload={() => void open(screen.repo.path)}
        onOpenPr={(url) => setScreen({ name: "pr", url, back: screen })}
        onConnections={(hint) => setScreen({ name: "connections", back: screen, ...(hint ? { hint } : {}) })}
        onGuide={(ref) => openGuide(screen.repo, { repo: screen.repo.path, ref })}
        onAnalyze={(base, head) => {
          const req = { repo: screen.repo.path, base, head };
          // 같은 비교를 다시 열면 보던 위치까지, 다른 비교면 테스트 표시만 저장소별로 이어간다
          const remembered = state.current.repos[req.repo];
          const same = remembered !== undefined && remembered.base === base && remembered.head === head;
          const selection = same ? remembered.selection : null;
          const showTests = remembered?.showTests ?? false;
          persist({ ...state.current, lastRepo: req.repo, lastView: "review", repos: { ...state.current.repos, [req.repo]: { ...req, selection, showTests } } });
          setScreen({ name: "review", repo: screen.repo, req, selection, showTests, pr: null });
        }}
      />
    );
  }
  // 둘러보기에서 온 LLM 설정도 리뷰처럼 둘러보기를 숨긴 채 위에 띄워 보던 자리와 받은 답을 지킨다
  if (screen.name === "guide" || (screen.name === "llm" && screen.back.name === "guide")) {
    const onLlm = screen.name === "llm";
    const gs = (screen.name === "llm" ? screen.back : screen) as Extract<Screen, { name: "guide" }>;
    const { repo, req } = gs;
    const last = state.current.guides[repo.path];
    const toCompare = () => {
      const remembered = state.current.repos[repo.path];
      setScreen({ name: "compare", repo, guideRef: req.ref, ...(remembered ? { base: remembered.base, head: remembered.head } : {}) });
    };
    return (
      <>
      <div className="screen-slot" hidden={onLlm}>
      <Guide
        key={`${req.repo}|${req.ref}|${req.dir ?? ""}|${req.force ? 1 : 0}`}
        active={!onLlm}
        answerStore={answers.current}
        onLlmSettings={() => setScreen({ name: "llm", back: gs })}
        req={req}
        repoName={repo.name}
        initial={last && last.ref === req.ref && last.dir === (req.dir ?? null) ? last : null}
        onBack={toCompare}
        onNarrow={(dir, force, draft) => openGuide(repo, { repo: repo.path, ref: req.ref, ...(dir ? { dir } : {}), ...(force ? { force } : {}) }, draft)}
        {...(gs.dirDraft ? { initialDir: gs.dirDraft } : {})}
        onPersist={(place) =>
          persist({
            ...state.current,
            lastRepo: repo.path,
            lastView: "guide",
            guides: { ...state.current.guides, [repo.path]: { ref: req.ref, dir: req.dir ?? null, ...(req.force ? { force: true } : {}), ...place } },
          })
        }
      />
      </div>
      {onLlm && <LlmSettings onBack={() => setScreen(gs)} backLabel="둘러보기로 돌아가기" />}
      </>
    );
  }
  const onLlm = screen.name === "llm";
  const rs = (screen.name === "llm" ? screen.back : screen) as Extract<Screen, { name: "review" }>;
  const { repo, req, pr } = rs;
  return (
    <>
      <div className="screen-slot" hidden={onLlm}>
    <Review
      key={`${req.repo}|${req.base}|${req.head}`}
      active={!onLlm}
      req={req}
      repoName={repo.name}
      pr={pr}
      onRefreshPr={() => pr && setScreen({ name: "pr", url: pr.url, back: rs })}
      initialSelection={rs.selection}
      initialShowTests={rs.showTests}
      onChangeCompare={() => {
        if (pr) {
          persist({ ...state.current, lastRepo: null });
          setScreen({ name: "start", error: null });
        } else setScreen({ name: "compare", repo, base: req.base, head: req.head });
      }}
      onLlmSettings={(selection, showTests) => setScreen({ name: "llm", back: { ...rs, selection, showTests } })}
      answerStore={answers.current}
      onPersist={(selection, showTests) =>
        persist({ ...state.current, lastRepo: req.repo, repos: { ...state.current.repos, [req.repo]: { ...req, selection, showTests } } })
      }
    />
      </div>
      {onLlm && <LlmSettings onBack={() => setScreen(rs)} backLabel="리뷰로 돌아가기" />}
    </>
  );
}
