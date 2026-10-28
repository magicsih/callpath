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
      if (s.last) {
        const r = await window.callpath.inspectRepo(s.last.repo);
        if (r.ok) {
          setScreen({ name: "review", repo: r.value, req: { repo: r.value.path, base: s.last.base, head: s.last.head }, selection: s.last.selection, showTests: s.last.showTests });
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
      setScreen({ name: "compare", repo: r.value });
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
          persist({ ...state.current, last: null });
          setScreen({ name: "start", error: null });
        }}
        onAnalyze={(base, head) => {
          const req = { repo: screen.repo.path, base, head };
          persist({ ...state.current, last: { ...req, selection: null, showTests: false } });
          setScreen({ name: "review", repo: screen.repo, req, selection: null, showTests: false });
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
      onPersist={(selection, showTests) => persist({ ...state.current, last: { ...req, selection, showTests } })}
    />
  );
}
