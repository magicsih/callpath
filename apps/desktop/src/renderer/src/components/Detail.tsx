import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CallOrderDiff, ReviewSession, Range, Step, SymbolRef } from "@callpath/core";
import type { Note } from "../../../shared/api";
import { CHANGE_LABEL, describeMoves, shortName, type NavItem } from "../nav";
import { languageFor } from "../monaco";
import { DiffView, type DiffInput, type Highlight } from "./DiffView";
import { Icon } from "./Icon";

type Load = { status: "loading" } | { status: "ready"; input: DiffInput; highlight: Highlight | null } | { status: "error"; message: string };

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
const linesOf = (r: Range) => Array.from({ length: r.endLine - r.startLine + 1 }, (_, i) => r.startLine + i + 1);

/** 메서드 하나를 base 범위와 head 범위로 잘라 비교할 입력 */
async function methodInput(session: ReviewSession, head: SymbolRef | null, base: SymbolRef | null, unchanged: boolean): Promise<DiffInput> {
  const { repo } = session;
  const path = (head ?? base)!.path;
  const language = languageFor(path);
  const common = { language, collapseUnchanged: false, revealLine: null };
  if (!head) {
    const b = await read(repo, session.base, path);
    return { kind: "removed", original: slice(b, base!.range), modified: "", originalStart: base!.range.startLine + 1, modifiedStart: 1, ...common };
  }
  const h = await read(repo, session.head, path);
  const headSlice = slice(h, head.range);
  if (unchanged) return { kind: "context", original: "", modified: headSlice, originalStart: 1, modifiedStart: head.range.startLine + 1, ...common };
  if (!base) return { kind: "added", original: "", modified: headSlice, originalStart: 1, modifiedStart: head.range.startLine + 1, ...common };
  const b = await read(repo, session.base, base.path);
  return { kind: "diff", original: slice(b, base.range), modified: headSlice, originalStart: base.range.startLine + 1, modifiedStart: head.range.startLine + 1, ...common };
}

async function buildInput(item: NavItem, session: ReviewSession): Promise<{ input: DiffInput; highlight: Highlight | null }> {
  if (item.kind === "test") {
    const t = item.test;
    return { input: await methodInput(session, t.symbol, t.baseSymbol, t.change === null), highlight: null };
  }
  if (item.kind === "file") {
    const path = item.file.path;
    const [b, h] = await Promise.all([read(session.repo, session.base, path), read(session.repo, session.head, path)]);
    if (isBinary(b) || isBinary(h)) {
      return { input: { kind: "context", original: "", modified: "이진 파일은 비교하지 않습니다.", language: "plaintext", originalStart: 1, modifiedStart: 1, collapseUnchanged: false, revealLine: null }, highlight: null };
    }
    // 메서드 밖 변경 묶음은 파일 전체를 보이되 그 구간만 강조한다(메서드 안 변경은 각 단계에서 본다)
    const highlight =
      item.groupId === "outside" || item.groupId === "otherTests"
        ? { original: item.file.hunks.flatMap((x) => (x.head ? [] : x.base ? linesOf(x.base) : [])), modified: item.file.hunks.flatMap((x) => (x.head ? linesOf(x.head) : [])) }
        : null;
    const first = item.file.hunks.find((x) => x.head)?.head;
    return {
      input: {
        kind: b === null ? "added" : h === null ? "removed" : "diff",
        original: b ?? "",
        modified: h ?? "",
        language: languageFor(path),
        originalStart: 1,
        modifiedStart: 1,
        collapseUnchanged: item.groupId === "nonCode",
        revealLine: first ? first.startLine + 1 : null,
      },
      highlight,
    };
  }
  const s: Step = item.step;
  if (s.change === "removed") return { input: await methodInput(session, null, s.symbol, false), highlight: null };
  return { input: await methodInput(session, s.symbol, s.baseSymbol, s.change === "unchanged"), highlight: null };
}

/** 칩을 눌렀을 때 강조할 줄: 그 호출과, 이동이면 반대쪽 짝 */
function chipHighlight(d: CallOrderDiff, side: "base" | "head", i: number): Highlight {
  const c = d[side][i]!;
  const other = side === "head" ? d.base : d.head;
  const partner = other.find((x) => x.name === c.name);
  const own = [c.line + 1];
  const pair = partner ? [partner.line + 1] : [];
  return side === "head" ? { modified: own, original: pair } : { original: own, modified: pair };
}

/** 이 보기가 보여 주는 head 쪽 줄 범위 안인지 */
function inShown(input: DiffInput, line: number): boolean {
  const text = input.kind === "removed" ? input.original : input.modified;
  const start = input.kind === "removed" ? input.originalStart : input.modifiedStart;
  return line >= start && line < start + text.split("\n").length;
}

export interface Crumbs {
  path: string[];
  next: string | null;
}

interface Props {
  item: NavItem;
  session: ReviewSession;
  onGoRef: (() => void) | null;
  refLabel: string | null;
  crumbs: Crumbs | null;
  notes: Note[];
  /** 저장하면 null, 실패하면 이유 */
  onAddNote: (path: string, line: number, body: string) => Promise<string | null>;
  /** 값이 바뀌면 현재 줄에 메모 작성 칸을 연다(m 키) */
  noteRequest: number;
  /** 메모 목록에서 고른 줄. 값이 바뀌면 그 줄로 가서 강조한다 */
  reveal: { line: number; nonce: number } | null;
  /** 작성 칸을 열 때(서랍이 작성 칸을 가리지 않게 닫는다) */
  onComposeStart: () => void;
  /** 이 코드의 메모 목록을 연다 */
  onShowNotes: () => void;
  /** 좁은 창에서 오른쪽 영역 대신 머리에 두는 내용(LLM 버튼) */
  headExtra?: ReactNode;
}

/** 메모를 남길 수 있는 head 쪽 파일과 처음 고른 줄. 삭제된 코드에는 남기지 않는다 */
export function noteTarget(item: NavItem): { path: string; line: number } | null {
  if (item.kind === "file") {
    if (item.file.status === "removed") return null;
    const first = item.file.hunks.find((h) => h.head)?.head;
    return { path: item.file.path, line: (first?.startLine ?? 0) + 1 };
  }
  const s = item.kind === "test" ? item.test.symbol : item.step.change === "removed" ? null : item.step.symbol;
  return s ? { path: s.path, line: s.range.startLine + 1 } : null;
}

export function Detail({ item, session, onGoRef, refLabel, crumbs, notes, onAddNote, noteRequest, reveal, onComposeStart, onShowNotes, headExtra }: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [chip, setChip] = useState<Highlight | null>(null);
  const target = noteTarget(item);
  const cursor = useRef<{ line: number; side: "head" | "base" } | null>(null);
  const [baseNotice, setBaseNotice] = useState(false);
  const [composer, setComposer] = useState<{ line: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const openComposer = (line?: number) => {
    if (!target) return;
    // 기준(왼쪽) 쪽 줄을 고른 채 m을 누르면 그 줄에는 남길 수 없다고 알린다. 메서드 첫 줄로 조용히 옮기지 않는다
    if (line === undefined && cursor.current?.side === "base") {
      setBaseNotice(true);
      return;
    }
    setBaseNotice(false);
    onComposeStart();
    const l = line ?? cursor.current?.line ?? target.line;
    setComposer({ line: l });
    // 어느 줄에 남기는지 보이게 그 줄을 강조한다
    setChip({ original: [], modified: [l] });
  };
  const closeComposer = () => {
    setComposer(null);
    // 취소한 초안이 다음 작성 칸에 섞여 올라가지 않게 비운다
    setDraft("");
    setSaveError(null);
    setFocusNonce((n) => n + 1);
  };
  useEffect(() => {
    cursor.current = null;
    setComposer(null);
    setDraft("");
    setSaveError(null);
    setBaseNotice(false);
  }, [item.key]);
  // 다시 분석하면 이 영역이 새로 그려진다. 그때 이미 처리한 요청을 다시 열지 않도록 처리한 값을 기억한다
  const handledNote = useRef(noteRequest);
  useEffect(() => {
    if (noteRequest === handledNote.current) return;
    handledNote.current = noteRequest;
    openComposer();
  }, [noteRequest]);
  const save = async () => {
    if (!target || !composer || !draft.trim()) return;
    setSaving(true);
    setSaveError(null);
    const error = await onAddNote(target.path, composer.line, draft);
    setSaving(false);
    if (error) return setSaveError(error);
    closeComposer();
    setDraft("");
  };
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
    setChip(null);
    buildInput(item, session).then(
      (r) => alive && setLoad({ status: "ready", ...r }),
      (e: Error) => alive && setLoad({ status: "error", message: e.message }),
    );
    return () => {
      alive = false;
    };
    // 정밀 분석 결과로 세션 객체만 바뀌면 비교할 코드는 같으므로 다시 읽지 않는다(깜빡임과 스크롤 위치 유지)
  }, [item.key, session.repo, session.base, session.head]);
  // 메모 목록에서 고른 줄을 강조한다. 다른 항목으로 옮겨 갈 때는 위의 불러오기가 강조를 지운 뒤에 돌아야 하므로 그 뒤에 둔다
  const handledReveal = useRef(reveal?.nonce);
  useEffect(() => {
    if (!reveal || reveal.nonce === handledReveal.current) return;
    handledReveal.current = reveal.nonce;
    setChip({ original: [], modified: [reveal.line] });
  }, [reveal?.nonce]);

  const sym = item.kind === "file" ? null : item.kind === "test" ? item.test.symbol : item.step.symbol;
  const shownNotes = target && load.status === "ready" ? notes.filter((n) => n.path === target.path && inShown(load.input, n.line)).map((n) => ({ line: n.line, body: n.body })) : [];
  const title = item.kind === "file" ? item.file.path.split("/").pop()! : item.kind === "test" ? item.test.symbol.name.replace(/`/g, "") : shortName(item.step.symbol);
  const path = item.kind === "file" ? item.file.path : sym!.path;
  const line = sym ? sym.range.startLine + 1 : null;
  const step = item.kind === "step" ? item.step : null;
  const moves = useMemo(() => (step ? describeMoves(step) : []), [step]);
  const view = load.status === "ready" ? load.input.kind : null;
  const note =
    item.kind === "step" && item.step.change === "unchanged"
      ? "흐름의 시작점입니다. 이 메서드는 바뀌지 않았습니다."
      : view === "added"
        ? "새로 추가된 코드입니다."
        : view === "removed"
          ? "삭제된 코드입니다."
          : view === "context"
            ? "바뀌지 않은 코드입니다."
            : item.kind === "file" && item.groupId === "outside"
              ? `메서드 밖에서 바뀐 ${item.file.hunks.length}곳을 강조했습니다. 메서드 안 변경은 각 단계에서 봅니다.`
              : item.kind === "file" && item.groupId === "otherTests"
                ? `단계에 붙지 않은 테스트 변경 ${item.file.hunks.length}곳을 강조했습니다. 나머지 테스트는 각 단계 아래에서 봅니다.`
                : null;

  return (
    <section className="pane center" aria-label="변경 내용">
      <header className="detail-head">
        <div className="title-row">
          {item.kind === "test" && <span className="chip"><Icon name="test" size={12} /> 테스트</span>}
          <h2 data-testid="detail-title" title={sym?.qualifiedName ?? path}>{title}</h2>
          {step && <span className={`chip change-${step.change}`}>{CHANGE_LABEL[step.change]}</span>}
          {step?.signatureChanged && step.change === "body" && <span className="chip change-signature">시그니처</span>}
          <span className="spacer" />
          {shownNotes.length > 0 && (
            <button
              className="chip memo-chip"
              onClick={onShowNotes}
              aria-label={`이 코드의 메모 ${shownNotes.length}개(${[...new Set(shownNotes.map((n) => n.line))].join(", ")}줄) 목록 열기`}
              data-testid="memo-chip"
            >
              ✎ 메모 {shownNotes.length}
            </button>
          )}
          {target && (
            <button className="note-open" onClick={() => openComposer()} aria-keyshortcuts="m" data-testid="note-open">
              메모 남기기 <kbd aria-hidden="true">m</kbd>
            </button>
          )}
        </div>
        <p className="muted path">{path}{line ? `:${line}` : ""}</p>
        {crumbs && crumbs.path.length > 0 && (
          <p className="crumbs" aria-label="호출 경로" title={crumbs.path.join(" › ")}>
            {crumbs.path.join(" › ")}
            {crumbs.next && <span className="muted"> · 다음 단계 {crumbs.next} <kbd aria-hidden="true">Enter</kbd></span>}
          </p>
        )}
        {headExtra && <div className="head-extra">{headExtra}</div>}
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

      {step?.callOrderDiff && (
        <div className={`call-order${moves.length ? " has-moves" : ""}`} data-testid="call-order" aria-label="호출 순서 비교">
          <div className="co-title">
            {moves.length > 0 && <Icon name="warn" />}
            <strong>{moves.length ? "호출 순서가 바뀌었습니다" : "호출 목록이 바뀌었습니다"}</strong>
            <span className="spacer" />
            <button
              className="link"
              onClick={() => {
                orderToggled.current = true;
                setOrderOpen((v) => !v);
              }}
              aria-expanded={orderOpen}
              aria-controls="co-rows"
            >
              {orderOpen ? "호출 목록 접기" : "호출 목록 보기"}
            </button>
          </div>
          {moves.map((m) => <p key={m} className="co-move">{m}</p>)}
          <div id="co-rows" hidden={!orderOpen}>
            {(["base", "head"] as const).map((side) => {
              const d = step.callOrderDiff!;
              return (
                <div className="co-row" key={side}>
                  <span className="co-side">{side === "base" ? "이전" : "이후"}</span>
                  <ol className="chips">
                    {d[side].map((c, i) => {
                      const moved = side === "head" && d.moved.includes(i);
                      const added = side === "head" && d.added.includes(i);
                      const removed = side === "base" && d.removed.includes(i);
                      const kind = moved ? "moved" : added ? "added" : removed ? "removed" : "";
                      const tag = moved ? "이동" : added ? "추가" : removed ? "삭제" : "";
                      const mark = moved ? "⚠ " : added ? "+ " : removed ? "− " : "";
                      const desc = `${c.name}${c.nested ? ", 인자 안 호출" : ""}${tag ? `, ${tag}` : ""}, ${c.line + 1}번째 줄`;
                      return (
                        <li key={i}>
                          <button
                            className={`call ${kind} ${c.nested ? "nested" : ""}`.trim()}
                            onClick={() => setChip(chipHighlight(d, side, i))}
                            aria-label={`${desc} 보기`}
                            title={desc}
                          >
                            {mark && <span aria-hidden="true">{mark}</span>}
                            {c.name}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
            <p className="legend muted">⚠ 이동, + 추가, − 삭제, 흐린 점선은 다른 호출의 인자 안 호출. 칩을 누르면 이전과 이후의 그 줄을 함께 강조합니다.</p>
          </div>
        </div>
      )}

      {baseNotice && (
        <p className="banner small" role="status" data-testid="base-notice">
          왼쪽은 바뀌기 전 코드라 메모를 남길 수 없습니다. 오른쪽(변경 후) 코드에서 줄을 고른 뒤 m을 누르세요.
        </p>
      )}
      {composer && target && (
        <form
          className="composer"
          data-testid="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="note-body">
            <strong>{target.path.split("/").pop()}:{composer.line}</strong>에 메모
          </label>
          <textarea
            id="note-body"
            aria-describedby="note-hint"
            rows={3}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeComposer();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
          />
          <div className="row">
            <button type="submit" className="primary" disabled={!draft.trim() || saving}>메모 저장</button>
            <button type="button" onClick={closeComposer}>취소</button>
            <span className="muted small" id="note-hint">⌘ Enter 저장, Esc 취소. 오른쪽(변경 후) 코드에서 다른 줄을 누른 뒤 m을 누르면 그 줄로 바꿉니다</span>
          </div>
          {saveError && <p className="error-text small" role="alert">{saveError}</p>}
        </form>
      )}

      {note && (
        <div className="banner" role="note" data-testid="view-note">
          <span>{note}</span>
        </div>
      )}

      <div className="diff-wrap">
        {load.status === "loading" && <div className="placeholder" role="status">코드를 읽는 중</div>}
        {load.status === "error" && <div className="placeholder error-text" role="alert"><Icon name="warn" /> 코드를 읽지 못했습니다: {load.message}</div>}
        {load.status === "ready" && (
          <DiffView
            input={load.input}
            highlight={chip ?? load.highlight}
            label={`${title} 비교`}
            notes={shownNotes}
            onCursorLine={(line, side) => {
              cursor.current = { line, side };
              if (side === "head") setBaseNotice(false);
            }}
            onNoteRequest={(l) => openComposer(l)}
            focusNonce={focusNonce}
            onNoteGlyph={onShowNotes}
          />
        )}
      </div>
    </section>
  );
}
