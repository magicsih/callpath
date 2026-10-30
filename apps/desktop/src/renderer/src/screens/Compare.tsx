import { useEffect, useState } from "react";
import type { ConnectionHint, PrList, ProviderKindName, RepoInfo } from "../../../shared/api";
import { Icon } from "../components/Icon";

/** 원격 주소에서 알아낸 호스트와 제공자로 연결 설정에 채울 값을 정한다. 제공자를 모르면 채우지 않는다 */
function hintFromRemote(host: string, webHost: string, kind: ProviderKindName | null): ConnectionHint {
  if (host === "github.com") return { choice: "github.com", host: "" };
  if (kind === "gitlab") return { choice: "gitlab", host: webHost };
  // 제공자를 모르면 GitHub.com 기본값으로 두지 않는다. 호스트를 채우고 GHE와 GitLab 중 고르게 한다
  return { choice: "ghe", host: webHost, ...(kind === "github" ? {} : { unsure: true }) };
}

export function Compare(props: {
  repo: RepoInfo;
  initialBase?: string;
  initialHead?: string;
  /** 둘러보기에서 돌아올 때 입력해 둔 브랜치(없는 이름을 고칠 수 있게) */
  initialGuideRef?: string;
  onBack: () => void;
  onReload: () => void;
  onAnalyze: (base: string, head: string) => void;
  /** 비교 없이 한 시점의 저장소를 둘러본다 */
  onGuide: (ref: string) => void;
  onOpenPr: (url: string) => void;
  onConnections: (hint?: ConnectionHint) => void;
}) {
  const { repo } = props;
  const [prs, setPrs] = useState<PrList | { status: "loading" } | { status: "error"; message: string }>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    window.callpath.listPullRequests(repo.path).then((r) => alive && setPrs(r.ok ? r.value : { status: "error", message: r.error }));
    return () => {
      alive = false;
    };
  }, [repo.path]);
  if (repo.branches.length === 0 && !repo.hasCommits) {
    return (
      <main className="compare" aria-labelledby="compare-title">
        <div className="start-card">
          <button className="link" onClick={props.onBack}>
            <Icon name="back" /> 저장소 바꾸기
          </button>
          <h1 id="compare-title">{repo.name}</h1>
          <p className="muted path">{repo.path}</p>
          <div className="notice" role="alert" data-testid="no-branches">
            <Icon name="warn" />
            <div>
              <p><strong>비교할 브랜치가 없습니다</strong></p>
              <p className="muted">이 저장소에는 아직 커밋이 없습니다. 커밋을 만든 뒤 다시 읽으세요.</p>
            </div>
          </div>
          <button className="primary big" onClick={props.onReload} autoFocus>다시 읽기</button>
        </div>
      </main>
    );
  }
  const [base, setBase] = useState(props.initialBase ?? repo.defaultBase ?? "");
  const [head, setHead] = useState(props.initialHead ?? repo.current ?? "");
  const [guideRef, setGuideRef] = useState(props.initialGuideRef ?? repo.current ?? repo.defaultBase ?? "");
  // 브랜치가 하나뿐이면 비교할 것이 없으니 둘러보기를 먼저 권한다
  const guideFirst = repo.branches.length === 1;
  const ready = base.trim() !== "" && head.trim() !== "";
  const known = (r: string) => repo.branches.includes(r.trim()) || /^[0-9a-f]{7,40}$/i.test(r.trim()) || /[~^]/.test(r);
  const warnings = [
    base.trim() && !known(base) ? `브랜치 목록에 없는 기준: "${base.trim()}". 태그나 커밋이면 그대로 분석합니다.` : null,
    head.trim() && !known(head) ? `브랜치 목록에 없는 리뷰할 변경: "${head.trim()}". 태그나 커밋이면 그대로 분석합니다.` : null,
    ready && base.trim() === head.trim() ? "기준과 리뷰할 변경이 같아 바뀐 파일이 없습니다. 지금 코드를 읽으려면 아래 저장소 둘러보기를 쓰세요." : null,
  ].filter((w): w is string => w !== null);
  return (
    <main className="compare" aria-labelledby="compare-title">
      <div className="start-card">
        <button className="link" onClick={props.onBack}>
          <Icon name="back" /> 저장소 바꾸기
        </button>
        <h1 id="compare-title">{repo.name}</h1>
        <p className="muted path">{repo.path}</p>
        <form
          className="compare-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) props.onAnalyze(base.trim(), head.trim());
          }}
        >
          <div className="ref-pair" role="group" aria-label="비교할 두 시점">
            <div className="ref">
              <label htmlFor="base">기준 (base)</label>
              <input id="base" list="branches" value={base} onChange={(e) => setBase(e.target.value)} />
              <span className="hint">합칠 대상 브랜치</span>
            </div>
            <span className="arrow" aria-hidden="true">←</span>
            <div className="ref">
              <label htmlFor="head">리뷰할 변경 (head)</label>
              <input id="head" list="branches" value={head} onChange={(e) => setHead(e.target.value)} />
              <span className="hint">PR 브랜치나 커밋</span>
            </div>
          </div>
          <datalist id="branches">
            {repo.branches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          {repo.branches.length === 0 && (
            <div className="notice" role="alert" data-testid="branch-read-failed">
              <Icon name="warn" />
              <div>
                <p><strong>브랜치 목록을 읽지 못했습니다</strong></p>
                <p className="muted">{repo.branchError ?? "저장소 권한이나 상태를 확인하세요."} 커밋 SHA를 직접 넣어 비교할 수 있습니다.</p>
              </div>
            </div>
          )}
          <p className="muted">두 시점의 공통 조상부터 head까지 바뀐 것을 봅니다.</p>
          {warnings.length > 0 && (
            <ul className="warnings" data-testid="compare-warnings" aria-live="polite">
              {warnings.map((w) => (
                <li key={w}><Icon name="warn" /> {w}</li>
              ))}
            </ul>
          )}
          <button type="submit" className={guideFirst ? "big" : "primary big"} disabled={!ready} autoFocus={!guideFirst}>
            흐름 분석
          </button>
        </form>
        <section aria-labelledby="guide-title" className="guide-start" data-testid="guide-start">
          <h2 id="guide-title">저장소 둘러보기</h2>
          <p className="muted">비교 없이 한 시점의 코드를 패키지 지도와 진입점 투어로 읽습니다. 처음 보는 저장소를 파악할 때 씁니다.</p>
          <form
            className="guide-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (guideRef.trim()) props.onGuide(guideRef.trim());
            }}
          >
            <div className="ref">
              <label htmlFor="guide-ref">둘러볼 브랜치나 커밋</label>
              <input id="guide-ref" list="branches" value={guideRef} onChange={(e) => setGuideRef(e.target.value)} />
            </div>
            <button type="submit" className={guideFirst ? "primary" : ""} disabled={!guideRef.trim()} autoFocus={guideFirst}>둘러보기</button>
          </form>
        </section>
        {prs.status !== "no-remote" && (
          <section aria-labelledby="open-prs-title" className="recent" data-testid="open-prs">
            <h2 id="open-prs-title">이 저장소의 열린 PR</h2>
            {prs.status === "loading" && <p className="muted" role="status">불러오는 중</p>}
            {prs.status === "error" && <p className="error-text"><Icon name="warn" /> {prs.message}</p>}
            {prs.status === "needs-connection" && (
              <p className="muted">
                {prs.webHost.replace(/^https?:\/\//, "")} PR을 보려면 연결이 필요합니다. <button className="link" onClick={() => props.onConnections(hintFromRemote(prs.host, prs.webHost, prs.kind))}>연결 설정</button>
              </p>
            )}
            {prs.status === "ok" && prs.prs.length === 0 && <p className="muted">열린 PR이 없습니다.</p>}
            {prs.status === "ok" && prs.prs.length > 0 && (
              <ul>
                {prs.prs.map((p) => (
                  <li key={p.number}>
                    <button className="recent-item" onClick={() => props.onOpenPr(p.url)}>
                      <span className="recent-name">#{p.number} {p.title}</span>
                      <span className="recent-path">{p.author}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
