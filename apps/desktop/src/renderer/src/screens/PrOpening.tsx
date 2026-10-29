import { useEffect, useState } from "react";
import type { ErrorKind, PrMeta, PrProgress } from "../../../shared/api";
import { Icon } from "../components/Icon";

export function PrOpening({ url, onOpened, onBack, onConnections }: { url: string; onOpened: (m: PrMeta) => void; onBack: () => void; onConnections: () => void }) {
  const [progress, setProgress] = useState<PrProgress | null>(null);
  const [error, setError] = useState<{ message: string; kind: ErrorKind } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    setProgress(null);
    const off = window.callpath.onPrProgress((p) => alive && p.url === url && setProgress(p));
    window.callpath.openPullRequest(url).then((r) => {
      if (!alive) return;
      if (r.ok) onOpened(r.value);
      else setError({ message: r.error, kind: r.kind });
    });
    return () => {
      alive = false;
      off();
    };
  }, [url, attempt]);

  if (error) {
    const needsSetup = error.kind === "connection" || error.kind === "auth";
    return (
      <div className="state" role="alert" data-testid="pr-error">
        <Icon name="warn" size={28} />
        <h2 className="state-title">PR을 열지 못했습니다</h2>
        <p className="muted">{error.message}</p>
        <div className="row">
          {needsSetup ? (
            <button className="primary" onClick={onConnections} autoFocus>연결 설정</button>
          ) : (
            <button className="primary" onClick={() => setAttempt((n) => n + 1)} autoFocus>다시 시도</button>
          )}
          <button onClick={onBack}>돌아가기</button>
        </div>
      </div>
    );
  }
  const step = progress?.step ?? "info";
  return (
    <div className="state" role="status" data-testid="pr-loading">
      <div className="spinner" aria-hidden="true" />
      <h2 className="state-title">PR을 여는 중</h2>
      <p className="muted path">{url}</p>
      <ol className="steps">
        <li className={step === "info" ? "current" : "done"}>{step === "info" ? "…" : "✓"} PR 정보 받기</li>
        <li className={step === "code" ? "current" : ""}>{step === "code" ? "…" : "·"} 코드 받기</li>
      </ol>
      {progress && <p className="muted small">{progress.message}</p>}
      <button onClick={onBack}>돌아가기</button>
    </div>
  );
}
