import { useEffect, useRef, useState } from "react";
import type { LlmSettingsInput, LlmSettingsView } from "../../../shared/api";
import { Icon } from "../components/Icon";

type Status = { s: "idle"; note?: string } | { s: "saving"; id: string; started: number } | { s: "saved"; note: string | null } | { s: "error"; message: string; kind: string };

export function LlmSettings({ onBack, backLabel = "돌아가기" }: { onBack: () => void; backLabel?: string }) {
  const [view, setView] = useState<LlmSettingsView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [headers, setHeaders] = useState("");
  const [clearHeaders, setClearHeaders] = useState(false);
  const [status, setStatus] = useState<Status>({ s: "idle" });
  const [now, setNow] = useState(Date.now());
  const title = useRef<HTMLHeadingElement>(null);
  const savedMsg = useRef<HTMLParagraphElement>(null);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const endpointInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  const apply = (v: LlmSettingsView) => {
    setView(v);
    setEnabled(v.enabled);
    setEndpoint(v.endpoint);
    setModel(v.model);
    setKey("");
    setClearKey(false);
    setHeaders("");
    setClearHeaders(false);
  };
  useEffect(() => {
    void window.callpath.getLlmSettings().then(apply);
    title.current?.focus();
  }, []);
  useEffect(() => {
    if (status.s !== "saving") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status.s]);
  // 결과가 그려진 뒤 초점을 옮긴다
  useEffect(() => {
    if (status.s === "saved") savedMsg.current?.focus();
    else if (status.s === "idle" && status.note) saveBtn.current?.focus();
    // 키가 거부되면 키 칸으로, 그 밖의 실패는 주소 칸으로
    else if (status.s === "error") (status.kind === "auth" ? keyInput : endpointInput).current?.focus();
  }, [status]);

  const ready = !enabled || (endpoint.trim() !== "" && model.trim() !== "");
  const noEndpoint = enabled && !endpoint.trim();
  const noModel = enabled && !model.trim();
  const missing = noEndpoint && noModel ? "저장하려면 끝점 주소와 모델을 넣으세요." : noEndpoint ? "저장하려면 끝점 주소를 넣으세요." : noModel ? "저장하려면 모델을 넣으세요." : "";
  // 저장하지 않은 변경이 있는지. 돌아갈 때 버릴지 묻는다
  const dirty =
    view !== null &&
    (enabled !== view.enabled || endpoint.trim() !== view.endpoint || model.trim() !== view.model || key.trim() !== "" || headers.trim() !== "" || clearKey || clearHeaders);
  const [leaving, setLeaving] = useState(false);
  // 저장하면 입력을 저장된 값으로 되돌리므로, 저장 뒤 다시 고친 것도 변경으로 본다
  const back = () => (dirty ? setLeaving(true) : onBack());
  const save = async () => {
    const id = crypto.randomUUID();
    setStatus({ s: "saving", id, started: Date.now() });
    setNow(Date.now());
    const input: LlmSettingsInput = {
      enabled,
      endpoint,
      model,
      ...(clearKey ? { apiKey: null } : key.trim() ? { apiKey: key } : {}),
      ...(clearHeaders ? { headers: null } : headers.trim() ? { headers } : {}),
    };
    const r = await window.callpath.saveLlmSettings(input, id);
    if (r.ok) {
      apply(r.value.view);
      setStatus({ s: "saved", note: r.value.note });
    } else if (r.kind === "cancelled") setStatus({ s: "idle", note: "확인을 멈췄습니다. 저장하지 않았습니다" });
    else setStatus({ s: "error", message: r.error, kind: r.kind });
  };

  return (
    <main className="compare" aria-labelledby="llm-title">
      <div className="start-card">
        <button className="link" onClick={back}>
          <Icon name="back" /> {backLabel}
        </button>
        {leaving && (
          <div className="banner" role="alertdialog" aria-labelledby="leave-title" data-testid="llm-leave">
            <span id="leave-title">저장하지 않은 변경이 있습니다. 버리고 돌아갈까요?</span>
            <button onClick={onBack} autoFocus>버리고 돌아가기</button>
            <button onClick={() => setLeaving(false)}>계속 고치기</button>
          </div>
        )}
        <h1 id="llm-title" tabIndex={-1} ref={title}>
          LLM 설정
        </h1>
        <p className="lead">흐름 요약과 메서드 설명에 쓸 OpenAI 호환 끝점을 등록합니다. 기본은 꺼져 있고, 꺼 두면 코드가 앱 밖으로 나가지 않습니다.</p>

        <section className="banner" aria-labelledby="llm-scope-title" data-testid="llm-scope">
          <h2 id="llm-scope-title" className="section-title">무엇이 어디로 나가는지</h2>
          <ul className="plain">
            <li>"이 흐름 요약", "이 메서드 설명"을 누르면 보낼 내용을 먼저 보여 주고, 확인해야 보냅니다. 저절로 보내는 일은 없습니다.</li>
            <li>보내는 것은 지금 보는 흐름이나 메서드의 바뀐 코드와 호출 구조뿐입니다. 저장소 전체나 다른 흐름은 보내지 않습니다.</li>
            <li>보낸 내용과 답은 이 컴퓨터의 기록 파일에 남습니다. 키와 헤더 값은 남기지 않습니다.</li>
          </ul>
          <button className="link" onClick={() => void window.callpath.showLlmLog()} data-testid="llm-log">
            보낸 기록 파일 보기
          </button>
        </section>

        <form
          className="compare-form"
          aria-labelledby="llm-form-title"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && status.s !== "saving") void save();
          }}
        >
          <h2 id="llm-form-title" className="section-title">끝점</h2>
          <label className="choice">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            LLM 설명 쓰기
          </label>
          <div className="ref">
            <label htmlFor="llm-endpoint">끝점 주소</label>
            <input
              id="llm-endpoint"
              ref={endpointInput}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://gateway.example.com/v1"
              aria-describedby="llm-endpoint-hint"
              spellCheck={false}
            />
            <span className="hint" id="llm-endpoint-hint">
              /chat/completions 앞까지의 주소입니다. 사내 게이트웨이나 로컬 모델(예: http://localhost:11434/v1)도 됩니다
            </span>
          </div>
          <div className="ref">
            <label htmlFor="llm-model">모델</label>
            <input id="llm-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="끝점에서 쓰는 모델 이름" spellCheck={false} />
          </div>
          <div className="ref">
            <label htmlFor="llm-key">API 키</label>
            <input
              id="llm-key"
              ref={keyInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              disabled={clearKey}
              onChange={(e) => setKey(e.target.value)}
              placeholder={view?.hasKey ? "저장된 키가 있습니다. 바꾸려면 새 키를 넣으세요" : ""}
              aria-describedby={view?.weakStorage ? "llm-key-hint llm-weak" : "llm-key-hint"}
            />
            <span className="hint" id="llm-key-hint">
              저장하면 암호화해 보관하고 다시 보여주지 않습니다. 키가 필요 없는 끝점이면 비워 둡니다.
            </span>
            {view?.hasKey && (
              <label className="choice small">
                <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> 저장된 키 지우기
              </label>
            )}
            {view?.weakStorage && (
              <span className="error-text small" id="llm-weak" data-testid="llm-weak">
                <Icon name="warn" size={12} /> 이 컴퓨터에는 암호 저장소(GNOME 키링, KWallet)가 없어 키를 고정 키로만 암호화합니다. 같은 계정의 다른 프로그램이 읽을 수 있습니다
              </span>
            )}
          </div>
          <div className="ref">
            <label htmlFor="llm-headers">추가 헤더 (선택)</label>
            <textarea
              id="llm-headers"
              rows={2}
              spellCheck={false}
              value={headers}
              disabled={clearHeaders}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder="X-Gateway-Token: …"
              aria-describedby="llm-headers-hint"
            />
            <span className="hint" id="llm-headers-hint">
              한 줄에 하나씩 "이름: 값". 값은 암호화해 보관하고 다시 보여주지 않습니다.
              {view && view.headerNames.length > 0 && ` 저장된 헤더: ${view.headerNames.join(", ")}`}
            </span>
            {view && view.headerNames.length > 0 && headers.trim() !== "" && !clearHeaders && (
              <span className="warn-text small" data-testid="llm-headers-replace">
                <Icon name="warn" size={12} /> 저장하면 저장된 헤더({view.headerNames.join(", ")})를 모두 지우고 지금 넣은 헤더로 바꿉니다. 남길 헤더도 함께 넣으세요
              </span>
            )}
            {view && view.headerNames.length > 0 && (
              <label className="choice small">
                <input type="checkbox" checked={clearHeaders} onChange={(e) => setClearHeaders(e.target.checked)} /> 저장된 헤더 지우기
              </label>
            )}
          </div>
          {status.s === "error" && (
            <div className="error-text" role="alert" data-testid="llm-error">
              <Icon name="warn" />
              <span>{status.message}</span>
            </div>
          )}
          {status.s === "idle" && status.note && <p className="muted" role="status">{status.note}</p>}
          {status.s === "saved" && (
            <div role="status" data-testid="llm-saved-wrap">
              <p className="ok-text" data-testid="llm-saved" tabIndex={-1} ref={savedMsg}>
                <Icon name="check" /> {view?.enabled ? `저장했습니다. ${view.model} 모델로 설명을 받습니다` : "저장했습니다. LLM 설명은 꺼져 있습니다"}
              </p>
              {status.note && (
                <p className="warn-text small" data-testid="llm-note">
                  <Icon name="warn" size={12} /> {status.note}
                </p>
              )}
            </div>
          )}
          {status.s === "saving" ? (
            <div className="row" role="status" data-testid="llm-checking">
              <div className="spinner small" aria-hidden="true" />
              <span>
                {enabled ? "모델 목록으로 끝점과 키를 확인하는 중" : "저장하는 중"} {Math.round((now - status.started) / 1000)}초 (최대 30초)
              </span>
              <button type="button" onClick={() => void window.callpath.cancelLlmCheck(status.id)}>
                확인 멈추기
              </button>
            </div>
          ) : (
            <button type="submit" className="primary big" disabled={!ready || view === null} ref={saveBtn}>
              {enabled ? "확인하고 저장" : "저장"}
            </button>
          )}
          {missing && status.s !== "saving" && (
            <p className="muted small" data-testid="llm-missing">
              {missing}
            </p>
          )}
          {enabled && <p className="muted small">확인할 때는 모델 목록만 묻고 코드는 보내지 않습니다.</p>}
        </form>
      </div>
    </main>
  );
}
