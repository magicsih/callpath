import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewSession, Range, Step } from "@callpath/core";
import { CHANGE_LABEL, describeMoves, shortName, type NavItem } from "../nav";
import { languageFor } from "../monaco";
import { DiffView, type DiffInput } from "./DiffView";
import { Icon } from "./Icon";

type Load = { status: "loading" } | { status: "ready"; input: DiffInput } | { status: "error"; message: string };

const cache = new Map<string, Promise<string | null>>();

function read(repo: string, ref: string, path: string): Promise<string | null> {
  const key = `${repo}\0${ref}\0${path}`;
  let p = cache.get(key);
  if (!p) {
    p = window.callpath.readFile({ repo, ref, path }).then((r) => {
      if (!r.ok) throw new Error(r.error);
      return r.value;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

function slice(text: string | null, range: Range | null): string {
  if (text === null || range === null) return "";
  return text.split("\n").slice(range.startLine, range.endLine + 1).join("\n");
}

const isBinary = (t: string | null) => t !== null && t.includes("\0");

async function buildInput(item: NavItem, session: ReviewSession): Promise<DiffInput> {
  const { repo, base, head } = session;
  if (item.kind === "file" || item.kind === "test") {
    const path = item.kind === "file" ? item.file.path : item.test.symbol.path;
    const [b, h] = await Promise.all([read(repo, base, path), read(repo, head, path)]);
    if (isBinary(b) || isBinary(h)) {
      return { kind: "context", original: "", modified: "이진 파일은 비교하지 않습니다.", language: "plaintext", originalStart: 1, modifiedStart: 1, collapseUnchanged: false, revealLine: null };
    }
    return {
      kind: b === null ? "added" : h === null ? "removed" : "diff",
      original: b ?? "",
      modified: h ?? "",
      language: languageFor(path),
      originalStart: 1,
      modifiedStart: 1,
      collapseUnchanged: true,
      revealLine: item.kind === "test" ? item.test.symbol.range.startLine + 1 : null,
    };
  }
  const s: Step = item.step;
  const path = s.symbol.path;
  const language = languageFor(path);
  if (s.change === "removed") {
    const b = await read(repo, base, path);
    return { kind: "removed", original: slice(b, s.symbol.range), modified: "", language, originalStart: s.symbol.range.startLine + 1, modifiedStart: 1, collapseUnchanged: false, revealLine: null };
  }
  const h = await read(repo, head, path);
  const headSlice = slice(h, s.symbol.range);
  if (s.change === "unchanged") {
    return { kind: "context", original: "", modified: headSlice, language, originalStart: s.symbol.range.startLine + 1, modifiedStart: s.symbol.range.startLine + 1, collapseUnchanged: false, revealLine: null };
  }
  const b = s.baseSymbol ? await read(repo, base, s.baseSymbol.path) : null;
  return {
    kind: s.baseSymbol ? "diff" : "added",
    original: slice(b, s.baseSymbol?.range ?? null),
    modified: headSlice,
    language,
    originalStart: (s.baseSymbol?.range.startLine ?? 0) + 1,
    modifiedStart: s.symbol.range.startLine + 1,
    collapseUnchanged: false,
    revealLine: null,
  };
}

export interface Crumbs {
  path: string[];
  next: string | null;
}

export function Detail({ item, session, onGoRef, refLabel, crumbs }: { item: NavItem; session: ReviewSession; onGoRef: (() => void) | null; refLabel: string | null; crumbs: Crumbs | null }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [highlight, setHighlight] = useState<number | null>(null);
  // 창 높이가 낮으면 호출 순서 띠를 요약 한 줄로 접어 diff 자리를 남긴다
  const [orderOpen, setOrderOpen] = useState(() => window.innerHeight >= 560);
  const orderToggled = useRef(false);
  useEffect(() => {
    const onResize = () => {
      if (!orderToggled.current) setOrderOpen(window.innerHeight >= 560);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoad({ status: "loading" });
    setHighlight(null);
    buildInput(item, session).then(
      (input) => alive && setLoad({ status: "ready", input }),
      (e: Error) => alive && setLoad({ status: "error", message: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [item.key, session]);

  const title = item.kind === "file" ? item.file.path.split("/").pop()! : item.kind === "test" ? item.test.symbol.name.replace(/`/g, "") : shortName(item.step.symbol);
  const viewNote = load.status === "ready" && load.input.kind !== "diff"
    ? { added: "새로 추가된 코드입니다.", removed: "삭제된 코드입니다.", context: "" }[load.input.kind]
    : "";
  const path = item.kind === "file" ? item.file.path : item.kind === "test" ? item.test.symbol.path : item.step.symbol.path;
  const line = item.kind === "file" ? null : (item.kind === "test" ? item.test.symbol : item.step.symbol).range.startLine + 1;
  const step = item.kind === "step" ? item.step : null;
  const moves = useMemo(() => (step ? describeMoves(step) : []), [step]);

  return (
    <section className="pane center" aria-label="변경 내용">
      <header className="detail-head">
        <div className="title-row">
          {item.kind === "test" && <span className="chip"><Icon name="test" size={12} /> 테스트</span>}
          <h2 data-testid="detail-title">{title}</h2>
          {step && <span className={`chip change-${step.change}`}>{CHANGE_LABEL[step.change]}</span>}
        </div>
        <p className="muted path">{path}{line ? `:${line}` : ""}</p>
        {crumbs && crumbs.path.length > 0 && (
          <p className="crumbs" aria-label="호출 경로">
            {crumbs.path.join(" › ")}
            {crumbs.next && <span className="muted"> · 다음 단계 {crumbs.next} <kbd aria-hidden="true">Enter</kbd></span>}
          </p>
        )}
      </header>

      {step?.refOf && onGoRef && (
        <div className="banner" role="note">
          <span>이 메서드는 {refLabel}에서 먼저 나왔습니다.</span>
          <button className="link" onClick={onGoRef}>그 단계로 이동</button>
        </div>
      )}
      {step?.confidence === "low" && (
        <div className="banner low" role="note">
          <Icon name="link" /> <span>호출 연결이 불확실합니다. 수신자 타입을 몰라 이름으로만 이었습니다.</span>
        </div>
      )}
      {item.kind === "step" && item.step.change === "unchanged" && (
        <div className="banner" role="note"><span>흐름의 시작점입니다. 이 메서드는 바뀌지 않았습니다.</span></div>
      )}

      {step?.callOrderDiff && (
        <div className={`call-order${moves.length ? " has-moves" : ""}`} data-testid="call-order" aria-label="호출 순서 비교">
          <div className="co-title">
            {moves.length > 0 && <Icon name="warn" />}
            <strong>{moves.length ? "호출 순서가 바뀌었습니다" : "호출 목록이 바뀌었습니다"}</strong>
            <span className="spacer" />
            <button className="link" onClick={() => {
                orderToggled.current = true;
                setOrderOpen((v) => !v);
              }} aria-expanded={orderOpen} aria-controls="co-rows">
              {orderOpen ? "호출 목록 접기" : "호출 목록 보기"}
            </button>
          </div>
          {moves.map((m) => <p key={m} className="co-move">{m}</p>)}
          <div id="co-rows" hidden={!orderOpen}>
          {(["base", "head"] as const).map((side) => {
            const d = step.callOrderDiff!;
            const list = d[side];
            return (
              <div className="co-row" key={side}>
                <span className="co-side">{side === "base" ? "이전" : "이후"}</span>
                <ol className="chips">
                  {list.map((c, i) => {
                    const moved = side === "head" && d.moved.includes(i);
                    const added = side === "head" && d.added.includes(i);
                    const removed = side === "base" && d.removed.includes(i);
                    const cls = [moved ? "moved" : added ? "added" : removed ? "removed" : "", c.nested ? "nested" : ""].join(" ").trim();
                    const tag = moved ? "이동" : added ? "추가" : removed ? "삭제" : "";
                    return (
                      <li key={i}>
                        {side === "head" ? (
                          <button className={`call ${cls}`} onClick={() => setHighlight(c.line + 1)} aria-label={`${c.name}${c.nested ? ", 인자 안 호출" : ""}${tag ? `, ${tag}` : ""}, ${c.line + 1}번째 줄 보기`}>
                            {moved && <Icon name="warn" size={11} />}{c.name}
                          </button>
                        ) : (
                          <span className={`call ${cls}`}>{c.name}{tag && <span className="sr-only">, {tag}</span>}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
          </div>
        </div>
      )}

      <div className="diff-wrap">
        {load.status === "loading" && <div className="placeholder" role="status">코드를 읽는 중</div>}
        {load.status === "error" && <div className="placeholder error-text" role="alert"><Icon name="warn" /> 코드를 읽지 못했습니다: {load.message}</div>}
        {load.status === "ready" && <DiffView input={load.input} highlightLine={highlight} label={`${title} 비교`} />}
        {viewNote && <span className="view-note">{viewNote}</span>}
      </div>
    </section>
  );
}
