import { useState } from "react";
import type { RepoInfo } from "../../../shared/api";
import { Icon } from "../components/Icon";

export function Compare(props: { repo: RepoInfo; initialBase?: string; initialHead?: string; onBack: () => void; onAnalyze: (base: string, head: string) => void }) {
  const { repo } = props;
  const [base, setBase] = useState(props.initialBase ?? repo.defaultBase ?? "");
  const [head, setHead] = useState(props.initialHead ?? repo.current ?? "");
  const ready = base.trim() !== "" && head.trim() !== "";
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
          <p className="muted">두 시점의 공통 조상부터 head까지 바뀐 것을 봅니다.</p>
          <button type="submit" className="primary big" disabled={!ready} autoFocus>
            흐름 분석
          </button>
        </form>
      </div>
    </main>
  );
}
