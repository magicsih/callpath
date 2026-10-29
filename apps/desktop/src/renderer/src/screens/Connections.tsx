import { useEffect, useRef, useState } from "react";
import type { ConnectionHint, ConnectionInput, ConnectionsState, ErrorKind, ProviderKindName } from "../../../shared/api";
import { Icon } from "../components/Icon";

type Choice = "github.com" | "ghe" | "gitlab";
type Status = { s: "idle" } | { s: "saving" } | { s: "saved"; user: string; host: string } | { s: "error"; message: string; kind: ErrorKind };

const LABEL: Record<Choice, string> = { "github.com": "GitHub.com", ghe: "GitHub Enterprise", gitlab: "GitLab" };

/** 한 번 더 눌러야 지운다 */
function DeleteConnection({ host, onConfirm }: { host: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="confirm" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setArmed(false)}>
      <button className="danger" onClick={onConfirm} autoFocus aria-label={`${host} 연결 지우기 확인`}>지우기 확인</button>
      <button onClick={() => setArmed(false)}>취소</button>
    </span>
  ) : (
    <button onClick={() => setArmed(true)} aria-label={`${host} 연결 지우기`}>지우기</button>
  );
}

export function Connections({ onBack, hint }: { onBack: () => void; hint?: ConnectionHint }) {
  const [state, setState] = useState<ConnectionsState | null>(null);
  // PR 주소나 저장소 원격에서 온 경우 제공자와 호스트를 미리 채운다
  const [choice, setChoice] = useState<Choice>(hint?.choice ?? "github.com");
  const [host, setHost] = useState(hint?.host ?? "");
  const hostInput = useRef<HTMLInputElement>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const savedMsg = useRef<HTMLParagraphElement>(null);
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
    // 토큰은 저장했거나 거부되면 입력칸에서 지운다. 호스트에 닿지 않은 경우는 주소만 고치면 되므로 남긴다
    if (r.ok || r.kind !== "network") setToken("");
    if (r.ok) {
      setStatus({ s: "saved", user: r.value.user ?? "", host: r.value.host });
      void reload();
      requestAnimationFrame(() => savedMsg.current?.focus());
    } else {
      setStatus({ s: "error", message: r.error, kind: r.kind });
      requestAnimationFrame(() => (r.kind === "network" ? (hostInput.current ?? tokenInput.current) : tokenInput.current)?.focus());
    }
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
                  <DeleteConnection host={c.host} onConfirm={() => void window.callpath.deleteConnection(c.id).then(reload)} />
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
              <input id="conn-host" ref={hostInput} value={host} onChange={(e) => setHost(e.target.value)} placeholder={choice === "gitlab" ? "gitlab.com" : "ghe.example.com"} aria-describedby="conn-host-hint" />
              <span className="hint" id="conn-host-hint">이름만 넣으면 https로 연결합니다. http 서버는 http://까지 넣습니다</span>
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
              <input
                id="conn-token"
                ref={tokenInput}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-describedby={state?.weakStorage ? "conn-token-hint weak-storage" : "conn-token-hint"}
              />
              <span className="hint" id="conn-token-hint">{kind === "gitlab" ? "api 권한이 있는 개인 액세스 토큰" : "비공개 저장소면 repo 권한이 있는 토큰"}. 저장하면 암호화해 보관하고 다시 보여주지 않습니다.</span>
              {state?.weakStorage && (
                <span className="error-text small" data-testid="weak-storage" id="weak-storage">
                  <Icon name="warn" size={12} /> 이 컴퓨터에는 암호 저장소(GNOME 키링, KWallet)가 없어 토큰을 고정 키로만 암호화합니다. 같은 계정의 다른 프로그램이 읽을 수 있습니다
                </span>
              )}
            </div>
          )}
          {status.s === "error" && (
            <div className="error-text" role="alert" data-testid="conn-error">
              <Icon name="warn" />
              <span>
                {status.message}
                {status.kind === "network" && <span className="block small">주소와 포트, 사내망(VPN) 연결을 확인하세요. 토큰은 지우지 않았습니다.</span>}
                {status.kind === "auth" && <span className="block small">토큰의 권한과 만료일을 확인하고 다시 넣으세요.</span>}
              </span>
            </div>
          )}
          {status.s === "saved" && (
            <p className="ok-text" role="status" data-testid="conn-saved" tabIndex={-1} ref={savedMsg}><Icon name="check" /> {status.host}에 {status.user}로 연결했습니다</p>
          )}
          <button type="submit" className="primary big" disabled={!ready || status.s === "saving"}>
            {status.s === "saving" ? "확인 중" : "연결 저장"}
          </button>
        </form>
      </div>
    </main>
  );
}
