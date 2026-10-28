import { useCallback, useEffect, useRef, useState } from "react";
import type { CompareRequest, RepoInfo, UiState } from "../../shared/api";
import { EMPTY_STATE } from "../../shared/api";
import { Start } from "./screens/Start";
import { Compare } from "./screens/Compare";
import { Review } from "./screens/Review";

type Screen =
  | { name: "boot" }
  | { name: "start"; error: string | null }
  | { name: "compare"; repo: RepoInfo; base?: string; head?: string }
  | { name: "review"; repo: RepoInfo; req: CompareRequest; selection: string | null; showTests: boolean };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [busy, setBusy] = useState(false);
  const state = useRef<UiState>(EMPTY_STATE);
  const [recent, setRecent] = useState<string[]>([]);

  const persist = useCallback((next: UiState) => {
    state.current = next;
    setRecent(next.recent);
    void window.callpath.saveState(next);
  }, []);

  // 마지막으로 보던 리뷰가 있으면 그 자리로 돌아간다
  useEffect(() => {
    void (async () => {
      const s = await window.callpath.loadState();
      state.current = s;
      setRecent(s.recent);
      const last = s.lastRepo ? s.repos[s.lastRepo] : undefined;
      if (last) {
        const r = await window.callpath.inspectRepo(last.repo);
        if (r.ok) {
          setScreen({ name: "review", repo: r.value, req: { repo: r.value.path, base: last.base, head: last.head }, selection: last.selection, showTests: last.showTests });
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

  const pick = useCallback(async () => {
    const path = await window.callpath.pickFolder();
    if (path) await open(path);
  }, [open]);

  if (screen.name === "boot") return <div className="state" role="status">불러오는 중</div>;
  if (screen.name === "start") return <Start recent={recent} error={screen.error} busy={busy} onOpen={open} onPick={pick} />;
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
        onAnalyze={(base, head) => {
          const req = { repo: screen.repo.path, base, head };
          // 같은 비교를 다시 열면 보던 위치까지, 다른 비교면 테스트 표시만 저장소별로 이어간다
          const remembered = state.current.repos[req.repo];
          const same = remembered !== undefined && remembered.base === base && remembered.head === head;
          const selection = same ? remembered.selection : null;
          const showTests = remembered?.showTests ?? false;
          persist({ ...state.current, lastRepo: req.repo, repos: { ...state.current.repos, [req.repo]: { ...req, selection, showTests } } });
          setScreen({ name: "review", repo: screen.repo, req, selection, showTests });
        }}
      />
    );
  }
  const { repo, req } = screen;
  return (
    <Review
      key={`${req.repo}|${req.base}|${req.head}`}
      req={req}
      repoName={repo.name}
      initialSelection={screen.selection}
      initialShowTests={screen.showTests}
      onChangeCompare={() => setScreen({ name: "compare", repo, base: req.base, head: req.head })}
      onPersist={(selection, showTests) =>
        persist({ ...state.current, lastRepo: req.repo, repos: { ...state.current.repos, [req.repo]: { ...req, selection, showTests } } })
      }
    />
  );
}
