import { useState } from "react";
import { Icon } from "../components/Icon";

export function Start(props: {
  recent: string[];
  recentPrs: Array<{ url: string; title: string }>;
  error: string | null;
  busy: boolean;
  onOpen: (path: string) => void;
  onPick: () => void;
  onOpenPr: (url: string) => void;
  onConnections: () => void;
  /** 형식이 틀려 열지 못한 PR 주소와 원인 */
  prError?: { url: string; message: string } | undefined;
}) {
  const [path, setPath] = useState("");
  const [prUrl, setPrUrl] = useState(props.prError?.url ?? "");
  const [prEdited, setPrEdited] = useState(false);
  const prError = prEdited ? null : (props.prError?.message ?? null);
  // 입력을 고치기 시작하면 이전 시도의 오류는 숨긴다
  const [edited, setEdited] = useState(false);
  const error = edited ? null : props.error;
  const name = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  return (
    <main className="start" aria-labelledby="start-title">
      <div className="start-card">
        <h1 id="start-title">Callpath</h1>
        <p className="lead">PR의 변경을 파일 순서가 아니라 호출 흐름 순서로 읽습니다.</p>
        <button className="primary big" onClick={props.onPick} disabled={props.busy}>
          <Icon name="folder" /> 폴더 열기
        </button>
        <form
          className="path-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!path.trim()) return;
            setEdited(false);
            props.onOpen(path.trim());
          }}
        >
          <label htmlFor="repo-path">저장소 경로</label>
          <div className="row">
            <input
              id="repo-path"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setEdited(true);
              }}
              placeholder="/Users/me/work/order-service"
              autoFocus
              aria-describedby={error ? "path-error" : undefined}
              aria-invalid={error ? true : undefined}
            />
            <button type="submit" disabled={props.busy || !path.trim()}>열기</button>
          </div>
          {error && (
            <p id="path-error" className="error-text" role="alert">
              <Icon name="warn" /> {error}
            </p>
          )}
        </form>
        <form
          className="path-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (prUrl.trim()) props.onOpenPr(prUrl.trim());
          }}
        >
          <label htmlFor="pr-url">PR 주소</label>
          <div className="row">
            <input
              id="pr-url"
              value={prUrl}
              onChange={(e) => {
                setPrUrl(e.target.value);
                setPrEdited(true);
              }}
              placeholder="https://github.com/owner/repo/pull/123"
              aria-describedby={prError ? "pr-error pr-hint" : "pr-hint"}
              aria-invalid={prError ? true : undefined}
              autoFocus={!!prError}
            />
            <button type="submit" disabled={props.busy || !prUrl.trim()}>PR 열기</button>
          </div>
          {prError && (
            <p id="pr-error" className="error-text" role="alert" data-testid="pr-url-error">
              <Icon name="warn" /> {prError}
            </p>
          )}
          <span className="hint" id="pr-hint">GitHub, GitHub Enterprise, GitLab. <button type="button" className="link" onClick={props.onConnections}>연결 설정</button></span>
        </form>
        {props.recentPrs.length > 0 && (
          <section aria-labelledby="recent-pr-title" className="recent">
            <h2 id="recent-pr-title">최근 PR</h2>
            <ul>
              {props.recentPrs.map((p) => (
                <li key={p.url}>
                  <button className="recent-item" onClick={() => props.onOpenPr(p.url)} disabled={props.busy}>
                    <span className="recent-name">{p.title}</span>
                    <span className="recent-path">{p.url}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="recent-title" className="recent">
          <h2 id="recent-title">최근 저장소</h2>
          {props.recent.length === 0 ? (
            <p className="muted">최근 연 저장소가 없습니다.</p>
          ) : (
            <ul>
              {props.recent.map((p) => (
                <li key={p}>
                  <button className="recent-item" onClick={() => props.onOpen(p)} disabled={props.busy}>
                    <span className="recent-name">{name(p)}</span>
                    <span className="recent-path">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
