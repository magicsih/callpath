import { useCallback, useEffect, useRef, useState } from "react";
import type { CompareRequest, ConnectionHint, PrMeta, RepoInfo, UiState } from "../../shared/api";
import { EMPTY_STATE } from "../../shared/api";
import { Start } from "./screens/Start";
import { Compare } from "./screens/Compare";
import { Review } from "./screens/Review";
import { Connections } from "./screens/Connections";
import { PrOpening } from "./screens/PrOpening";
import { LlmSettings } from "./screens/LlmSettings";

type Screen =
  | { name: "boot" }
  | { name: "start"; error: string | null; prError?: { url: string; message: string } }
  | { name: "compare"; repo: RepoInfo; base?: string; head?: string }
  | { name: "review"; repo: RepoInfo; req: CompareRequest; selection: string | null; showTests: boolean; pr: PrMeta | null }
  | { name: "connections"; back: Screen; hint?: ConnectionHint }
  | { name: "llm"; back: Screen }
  | { name: "pr"; url: string; back: Screen };

/** PR 리뷰는 앱 캐시의 bare 저장소를 쓰므로 그 경로로 화면용 저장소 정보를 만든다 */
function prRepo(m: PrMeta): RepoInfo {
  return { path: m.gitDir, name: m.repo.split("/").pop() ?? m.repo, branches: [], defaultBase: null, current: null, hasCommits: true, branchError: null };
}

export function App() {
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
        repos: { ...state.current.repos, [m.gitDir]: { ...req, selection, showTests } },
        prs: { ...state.current.prs, [m.gitDir]: m },
        recentPrs: [{ url: m.url, title: `#${m.number} ${m.title}` }, ...state.current.recentPrs.filter((p) => p.url !== m.url)].slice(0, 10),
      });
      setScreen({ name: "review", repo: prRepo(m), req, selection, showTests, pr: m });
    },
    [persist],
  );

  const pick = useCallback(async () => {
    const path = await window.callpath.pickFolder();
    if (path) await open(path);
  }, [open]);

  if (screen.name === "boot") return <div className="state" role="status">불러오는 중</div>;
  if (screen.name === "llm") return <LlmSettings onBack={() => setScreen(screen.back)} backLabel={screen.back.name === "review" ? "리뷰로 돌아가기" : "돌아가기"} />;
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
        onBack={() => {
          persist({ ...state.current, lastRepo: null });
          setScreen({ name: "start", error: null });
        }}
        onReload={() => void open(screen.repo.path)}
        onOpenPr={(url) => setScreen({ name: "pr", url, back: screen })}
        onConnections={(hint) => setScreen({ name: "connections", back: screen, ...(hint ? { hint } : {}) })}
        onAnalyze={(base, head) => {
          const req = { repo: screen.repo.path, base, head };
          // 같은 비교를 다시 열면 보던 위치까지, 다른 비교면 테스트 표시만 저장소별로 이어간다
          const remembered = state.current.repos[req.repo];
          const same = remembered !== undefined && remembered.base === base && remembered.head === head;
          const selection = same ? remembered.selection : null;
          const showTests = remembered?.showTests ?? false;
          persist({ ...state.current, lastRepo: req.repo, repos: { ...state.current.repos, [req.repo]: { ...req, selection, showTests } } });
          setScreen({ name: "review", repo: screen.repo, req, selection, showTests, pr: null });
        }}
      />
    );
  }
  const { repo, req, pr } = screen;
  return (
    <Review
      key={`${req.repo}|${req.base}|${req.head}`}
      req={req}
      repoName={repo.name}
      pr={pr}
      onRefreshPr={() => pr && setScreen({ name: "pr", url: pr.url, back: screen })}
      initialSelection={screen.selection}
      initialShowTests={screen.showTests}
      onChangeCompare={() => {
        if (pr) {
          persist({ ...state.current, lastRepo: null });
          setScreen({ name: "start", error: null });
        } else setScreen({ name: "compare", repo, base: req.base, head: req.head });
      }}
      onLlmSettings={(selection, showTests) => setScreen({ name: "llm", back: { ...screen, selection, showTests } })}
      onPersist={(selection, showTests) =>
        persist({ ...state.current, lastRepo: req.repo, repos: { ...state.current.repos, [req.repo]: { ...req, selection, showTests } } })
      }
    />
  );
}
