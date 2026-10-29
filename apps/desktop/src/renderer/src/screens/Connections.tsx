import { useEffect, useState } from "react";
import type { ConnectionInput, ConnectionsState, ProviderKindName } from "../../../shared/api";
import { Icon } from "../components/Icon";

type Choice = "github.com" | "ghe" | "gitlab";
type Status = { s: "idle" } | { s: "saving" } | { s: "saved"; user: string; host: string } | { s: "error"; message: string };

const LABEL: Record<Choice, string> = { "github.com": "GitHub.com", ghe: "GitHub Enterprise", gitlab: "GitLab" };

export function Connections({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<ConnectionsState | null>(null);
  const [choice, setChoice] = useState<Choice>("github.com");
  const [host, setHost] = useState("");
  const [auth, setAuth] = useState<"gh-cli" | "token">("gh-cli");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>({ s: "idle" });

  const reload = () => window.callpath.listConnections().then(setState);
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (state && !state.ghCli && choice === "github.com") setAuth("token");
  }, [state, choice]);

  const kind: ProviderKindName = choice === "gitlab" ? "gitlab" : "github";
  const useCli = choice === "github.com" && auth === "gh-cli";
  const needsHost = choice !== "github.com";
  const ready = (!needsHost || host.trim() !== "") && (useCli || token.trim() !== "");

  const save = async () => {
    setStatus({ s: "saving" });
    const input: ConnectionInput = { kind, host: choice === "github.com" ? "github.com" : host.trim() || (choice === "gitlab" ? "gitlab.com" : ""), auth: useCli ? "gh-cli" : "token", ...(useCli ? {} : { token }) };
    const r = await window.callpath.saveConnection(input);
    // 토큰은 저장하든 실패하든 입력칸에서 바로 지운다
    setToken("");
    if (r.ok) {
      setStatus({ s: "saved", user: r.value.user ?? "", host: r.value.host });
      void reload();
    } else setStatus({ s: "error", message: r.error });
  };

  return (
    <main className="compare" aria-labelledby="conn-title">
      <div className="start-card">
        <button className="link" onClick={onBack}>
          <Icon name="back" /> 돌아가기
        </button>
        <h1 id="conn-title">연결 설정</h1>
        <p className="lead">PR을 읽고 코멘트를 올릴 계정을 연결합니다.</p>

        <section aria-labelledby="conn-list-title" className="recent">
          <h2 id="conn-list-title">연결된 계정</h2>
          {state === null ? (
            <p className="muted" role="status">불러오는 중</p>
          ) : state.connections.length === 0 ? (
            <p className="muted">연결된 계정이 없습니다.</p>
          ) : (
            <ul data-testid="connections">
              {state.connections.map((c) => (
                <li key={c.id} className="conn-row">
                  <div className="conn-text">
                    <span className="recent-name">{c.host === "github.com" ? "GitHub.com" : `${c.kind === "gitlab" ? "GitLab" : "GitHub Enterprise"} (${c.host})`}</span>
                    <span className="recent-path">
                      {c.user ? `${c.user}로 확인됨` : "확인 안 됨"}, {c.auth === "gh-cli" ? "gh CLI 계정으로 연결" : "토큰으로 연결"}
                    </span>
                    {c.weakStorage && <span className="error-text small"><Icon name="warn" size={12} /> 이 컴퓨터에는 암호 저장소가 없어 토큰을 약하게 보관합니다</span>}
                  </div>
                  <button onClick={() => window.callpath.deleteConnection(c.id).then(reload)} aria-label={`${c.host} 연결 지우기`}>지우기</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          className="compare-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && status.s !== "saving") void save();
          }}
          aria-labelledby="conn-add-title"
        >
          <h2 id="conn-add-title" className="section-title">연결 추가</h2>
          <fieldset className="choices">
            <legend>제공자</legend>
            {(Object.keys(LABEL) as Choice[]).map((c) => (
              <label key={c} className="choice">
                <input type="radio" name="provider" checked={choice === c} onChange={() => { setChoice(c); setHost(c === "gitlab" ? "gitlab.com" : ""); setStatus({ s: "idle" }); }} />
                {LABEL[c]}
              </label>
            ))}
          </fieldset>
          {needsHost && (
            <div className="ref">
              <label htmlFor="conn-host">호스트</label>
              <input id="conn-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder={choice === "gitlab" ? "gitlab.com" : "ghe.example.com"} />
              <span className="hint">이름만 넣으면 https로 연결합니다</span>
            </div>
          )}
          {choice === "github.com" && (
            <fieldset className="choices">
              <legend>연결 방식</legend>
              <label className="choice">
                <input type="radio" name="auth" checked={auth === "gh-cli"} disabled={!state?.ghCli} onChange={() => setAuth("gh-cli")} />
                gh CLI 계정 쓰기 {state && !state.ghCli && <span className="muted small">(gh CLI가 로그인되어 있지 않습니다)</span>}
              </label>
              <label className="choice">
                <input type="radio" name="auth" checked={auth === "token"} onChange={() => setAuth("token")} />
                토큰 넣기
              </label>
            </fieldset>
          )}
          {!useCli && (
            <div className="ref">
              <label htmlFor="conn-token">토큰</label>
              <input id="conn-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
              <span className="hint">{kind === "gitlab" ? "api 권한이 있는 개인 액세스 토큰" : "비공개 저장소면 repo 권한이 있는 토큰"}. 저장하면 암호화해 보관하고 다시 보여주지 않습니다.</span>
            </div>
          )}
          {status.s === "error" && (
            <p className="error-text" role="alert" data-testid="conn-error"><Icon name="warn" /> {status.message}</p>
          )}
          {status.s === "saved" && (
            <p className="ok-text" role="status" data-testid="conn-saved"><Icon name="check" /> {status.host}에 {status.user}로 연결했습니다</p>
          )}
          <button type="submit" className="primary big" disabled={!ready || status.s === "saving"}>
            {status.s === "saving" ? "확인 중" : "연결 저장"}
          </button>
        </form>
      </div>
    </main>
  );
}
