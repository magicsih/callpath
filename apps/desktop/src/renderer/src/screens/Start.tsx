import { useState } from "react";
import { Icon } from "../components/Icon";

export function Start(props: { recent: string[]; error: string | null; busy: boolean; onOpen: (path: string) => void; onPick: () => void }) {
  const [path, setPath] = useState("");
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
            if (path.trim()) props.onOpen(path.trim());
          }}
        >
          <label htmlFor="repo-path">저장소 경로</label>
          <div className="row">
            <input
              id="repo-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/me/work/order-service"
              autoFocus
              aria-describedby={props.error ? "path-error" : undefined}
              aria-invalid={props.error ? true : undefined}
            />
            <button type="submit" disabled={props.busy || !path.trim()}>열기</button>
          </div>
          {props.error && (
            <p id="path-error" className="error-text" role="alert">
              <Icon name="warn" /> {props.error}
            </p>
          )}
        </form>
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
