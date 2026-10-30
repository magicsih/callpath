import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { RepoGuide } from "@callpath/core";
import { KIND_LABEL, ROLE_LABEL, implementorCallers, implementors, mapColumns, neighbors } from "../guideNav";
import { Breakable } from "./Breakable";

interface Props {
  guide: RepoGuide;
  selected: string | null;
  onSelect: (id: string) => void;
  /** 고른 칩을 한 번 더 누르면 코드를 연다 */
  onOpen: (id: string) => void;
  /** 초점을 옮길 칩(패키지 목록, 지도에서 보기). pkg가 있으면 그 행을 잠깐 강조한다. nonce가 바뀔 때마다 옮긴다 */
  focusRequest: { id: string; nonce: number; pkg?: string } | null;
  /** 맥락 목록에서 가리킨 클래스. 그 클래스와 잇는 선만 진하게 그린다 */
  emphasis: string | null;
}

interface Line {
  key: string;
  /** 고른 클래스가 아닌 쪽 */
  other: string;
  d: string;
  kind: "caller" | "callee";
  low: boolean;
  calls: number;
}

const PKG_COL = 108;

/** 선이 이보다 많으면 호출이 많은 것만 그린다 */
const MAX_LINES = 40;
/** 선이 이보다 많으면 같은 열 안의 연결은 선 없이 칩 테두리로만 보인다(세로 다발이 칩 이름을 덮는다) */
const DENSE_LINES = 15;

/**
 * 설계 7단계 3.1 지도. 행은 패키지, 열은 역할인 표에 클래스를 칩으로 놓는다(D17).
 * 고른 칩의 연결만 선으로 잇는다. 칩은 하나만 Tab으로 들어가고 화살표로 옮긴다
 */
export function GuideMap({ guide, selected, onSelect, onOpen, focusRequest, emphasis }: Props) {
  const cols = useMemo(() => mapColumns(guide), [guide]);
  const byId = useMemo(() => new Map(guide.classes.map((c) => [c.id, c])), [guide]);
  // 열마다 그 열 칩 이름의 가장 긴 단어가 끊기지 않는 폭(최소 100px, 최대 170px)을 기본으로 하고,
  // 패키지 하나에 칩이 평균 둘 이상 놓이는 역할은 최대 4배까지 넓혀 한 줄에 여러 칩이 놓이게 한다. 표가 더 넓으면 남는 폭을 같은 비율로 나눈다
  const widths = useMemo(
    () =>
      cols.map((r) => {
        const chips = guide.classes.filter((c) => c.role === r);
        const word = Math.max(0, ...chips.map((c) => Math.max(...c.name.split(/(?=[A-Z][a-z])|(?<=[./])/).map((w) => w.length)) + (c.entryIds.length ? 2 : 0)));
        const base = Math.min(170, Math.max(100, Math.ceil(word * 7 + 34)));
        return Math.round(base * Math.min(4, Math.max(1, chips.length / Math.max(1, guide.packages.length) / 2)));
      }),
    [guide, cols],
  );
  const minWidth = PKG_COL + widths.reduce((a, b) => a + b, 0);
  const rel = useMemo(() => {
    if (!selected) return null;
    const near = neighbors(guide, selected);
    const impls = implementors(guide, selected);
    // 인터페이스를 고르면 실제 호출은 구현으로 이어져 있으므로, 구현을 부르는 쪽을 이 인터페이스를 부르는 쪽처럼 잇는다
    const viaImpl = implementorCallers(guide, selected).filter((n) => !near.callers.some((c) => c.node.id === n.node.id));
    return { callers: [...near.callers, ...viaImpl], callees: near.callees, impls };
  }, [guide, selected]);
  const relOf = (id: string): string => {
    if (!rel) return "";
    if (id === selected) return "selected";
    if (rel.callees.some((n) => n.node.id === id)) return "callee";
    if (rel.callers.some((n) => n.node.id === id)) return "caller";
    if (rel.impls.some((n) => n.id === id)) return "impl";
    if (emphasis === id) return "emph";
    return "dim";
  };
  // 읽는 차례(행, 열, 칩 순)
  const order = useMemo(
    () => guide.packages.flatMap((p) => cols.flatMap((r) => p.classIds.filter((id) => byId.get(id)?.role === r))),
    [guide, cols, byId],
  );
  const [focusId, setFocusId] = useState<string | null>(selected ?? order[0] ?? null);
  const [flash, setFlash] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [hidden, setHidden] = useState(0);
  const [sameCol, setSameCol] = useState(0);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const box = inner.current;
    if (!box || !selected || !rel) {
      setLines([]);
      setHidden(0);
      setSameCol(0);
      return;
    }
    const base = box.getBoundingClientRect();
    const rect = (id: string) => {
      const r = chips.current.get(id)?.getBoundingClientRect();
      return r ? { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top } : null;
    };
    const path = (from: string, to: string): string | null => {
      const a = rect(from);
      const b = rect(to);
      if (!a || !b) return null;
      // 옆 열이면 옆 가장자리끼리, 같은 열이면 위아래 가장자리끼리 잇는다
      if (b.l > a.r || a.l > b.r) {
        const right = b.l > a.r;
        const x1 = right ? a.r : a.l;
        const x2 = right ? b.l : b.r;
        const y1 = (a.t + a.b) / 2;
        const y2 = (b.t + b.b) / 2;
        const dx = (x2 - x1) * 0.45;
        return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      }
      const down = b.t > a.b;
      const x1 = (a.l + a.r) / 2;
      const x2 = (b.l + b.r) / 2;
      const y1 = down ? a.b : a.t;
      const y2 = down ? b.t : b.b;
      const dy = (y2 - y1) * 0.45;
      return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
    };
    const role = byId.get(selected)?.role;
    const dense = rel.callers.length + rel.callees.length > DENSE_LINES;
    let skipped = 0;
    const all: Line[] = [];
    const add = (other: string, from: string, to: string, kind: Line["kind"], low: boolean, calls: number) => {
      if (dense && byId.get(other)?.role === role && other !== emphasis) {
        skipped++;
        return;
      }
      const d = path(from, to);
      if (d) all.push({ key: `${kind}:${other}`, other, d, kind, low, calls });
    };
    for (const n of rel.callers) add(n.node.id, n.node.id, selected, "caller", n.low, n.calls);
    for (const n of rel.callees) add(n.node.id, selected, n.node.id, "callee", n.low, n.calls);
    const kept = all.length > MAX_LINES ? [...all].sort((a, b) => Number(b.other === emphasis) - Number(a.other === emphasis) || b.calls - a.calls).slice(0, MAX_LINES) : all;
    setLines(kept);
    setHidden(all.length - kept.length);
    setSameCol(skipped);
  }, [selected, rel, emphasis, byId]);

  useLayoutEffect(() => measure(), [measure, guide]);
  // 오른쪽으로 열이 더 있으면 가장자리에 넘침 표시를 둔다(스크롤 막대가 숨는 환경에서도 알 수 있게)
  const checkMore = useCallback(() => {
    const s = scroller.current;
    setMore(!!s && s.scrollLeft + s.clientWidth < s.scrollWidth - 2);
  }, []);
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    checkMore();
    const ro = new ResizeObserver(checkMore);
    ro.observe(s);
    s.addEventListener("scroll", checkMore, { passive: true });
    return () => {
      ro.disconnect();
      s.removeEventListener("scroll", checkMore);
    };
  }, [checkMore, guide]);
  useEffect(() => {
    const box = inner.current;
    if (!box) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  // 고르면 맥락이 지도 아래로 내려와 지도가 줄어들 수 있어, 배치가 끝난 뒤 고른 칩을 보이는 곳으로 옮긴다
  useEffect(() => {
    if (!selected) return;
    setFocusId(selected);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => chips.current.get(selected)?.scrollIntoView({ block: "nearest", inline: "nearest" })));
    return () => cancelAnimationFrame(id);
  }, [selected]);

  const moveTo = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    const el = chips.current.get(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  useEffect(() => {
    if (!focusRequest) return;
    moveTo(focusRequest.id);
    if (!focusRequest.pkg) return;
    rows.current.get(focusRequest.pkg)?.scrollIntoView({ block: "nearest" });
    setFlash(focusRequest.pkg);
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [focusRequest?.nonce]);

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-class-id]")?.dataset.classId;
    if (!id) return;
    const i = order.indexOf(id);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      moveTo(order[i + (e.key === "ArrowRight" ? 1 : -1)]);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // 다음(이전) 패키지 행에서 가로 위치가 가장 가까운 칩으로 간다
      const pkg = byId.get(id)!.packageName;
      const pi = guide.packages.findIndex((p) => p.name === pkg);
      const step = e.key === "ArrowDown" ? 1 : -1;
      const here = chips.current.get(id)!.getBoundingClientRect();
      for (let j = pi + step; j >= 0 && j < guide.packages.length; j += step) {
        const ids = order.filter((x) => byId.get(x)?.packageName === guide.packages[j]!.name);
        if (!ids.length) continue;
        const dist = (x: string) => {
          const r = chips.current.get(x)?.getBoundingClientRect();
          return r ? Math.abs((r.left + r.right) / 2 - (here.left + here.right) / 2) : Infinity;
        };
        moveTo([...ids].sort((a, b) => dist(a) - dist(b))[0]);
        return;
      }
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveTo(e.key === "Home" ? order[0] : order[order.length - 1]);
    }
  };

  const entryWord = guide.noEntries ? "공개 API 투어가 있는 클래스" : "진입점이 있는 클래스";
  const legend = (
    <div className="map-legend small muted" data-testid="map-legend">
      {guide.noEntries && (
        <span className="legend-warn">
          {guide.entries.length ? "진입점 규칙에 맞는 메서드가 없어 투어는 공개 API로 대신합니다." : "투어를 시작할 진입점이 없습니다(공개 API도 없음)."}
        </span>
      )}
      {selected ? (
        <>
          <span><span className="legend-line callee" aria-hidden="true" /> 고른 클래스가 부르는 것</span>
          <span><span className="legend-line caller" aria-hidden="true" /> 고른 클래스를 부르는 쪽</span>
          <span><span className="legend-line low" aria-hidden="true" /> 점선: 연결 불확실<span className="legend-long">(이름이나 구현 후보로 이음)</span></span>
          {rel && rel.impls.length > 0 && <span><span className="legend-box impl" aria-hidden="true" /> 점선 테두리: {byId.get(selected)?.kind === "interface" ? "구현" : "하위 클래스"}</span>}
          {sameCol > 0 && <span className="legend-warn">같은 열 안 연결 {sameCol}개는 칩 테두리로만 보입니다</span>}
          {hidden > 0 && <span className="legend-warn">선이 많아 호출이 많은 {MAX_LINES}개만 그렸습니다({hidden}개 생략)</span>}
        </>
      ) : (
        <span className="legend-hint">칩을 고르면 연결을 선으로 잇습니다. 화살표 키로 칩 사이를 옮기고 Enter로 고릅니다.</span>
      )}
      {guide.entries.length > 0 && <span><span className="chip-entry" aria-hidden="true">▶</span>{entryWord}</span>}
    </div>
  );

  if (guide.classes.length === 0) {
    return <p className="placeholder" data-testid="map-empty">이 시점에는 지도로 그릴 Java, Kotlin 클래스가 없습니다.</p>;
  }
  return (
    <>
      {legend}
      <div className={`map-wrap${more ? " more" : ""}`}>
      <div className="map-scroll" ref={scroller} data-testid="guide-map">
        <div className="map-inner" ref={inner}>
          <svg className="map-lines" aria-hidden="true">
            <defs>
              {(["callee", "caller"] as const).map((k) => (
                <marker key={k} id={`arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" className={`arrow-${k}`} />
                </marker>
              ))}
            </defs>
            {lines.map((l) => (
              <path
                key={l.key}
                d={l.d}
                className={`map-line ${l.kind}${l.low ? " low" : ""}${emphasis ? (l.other === emphasis ? " emph" : " faint") : ""}`}
                markerEnd={`url(#arrow-${l.kind})`}
              />
            ))}
          </svg>
          <table className="map-grid" onKeyDown={onKey} aria-label="패키지와 역할 지도" style={{ minWidth }}>
            <colgroup>
              <col style={{ width: PKG_COL }} />
              {cols.map((r, i) => <col key={r} style={{ width: widths[i] }} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="map-corner">패키지</th>
                {cols.map((r) => (
                  <th key={r} scope="col" className={`map-col role-${r}`}>{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.packages.map((p) => (
                <tr key={p.name} ref={(el) => void (el ? rows.current.set(p.name, el) : rows.current.delete(p.name))} className={flash === p.name ? "flash" : ""}>
                  <th scope="row" className="map-pkg" title={p.name || "(기본 패키지)"}>
                    <span className="map-pkg-name"><Breakable text={p.label} /></span>
                    <span className="dim">파일 {p.files}</span>
                  </th>
                  {cols.map((r) => (
                    <td key={r} className="map-cell">
                      <div className="cell-chips">
                        {p.classIds
                          .map((id) => byId.get(id)!)
                          .filter((c) => c.role === r)
                          .map((c) => {
                            const how = relOf(c.id);
                            return (
                              <button
                                key={c.id}
                                ref={(el) => void (el ? chips.current.set(c.id, el) : chips.current.delete(c.id))}
                                className={`map-chip role-${c.role} ${how}`}
                                data-class-id={c.id}
                                data-testid="map-chip"
                                tabIndex={c.id === (focusId ?? order[0]) ? 0 : -1}
                                aria-pressed={c.id === selected}
                                title={`${c.name}, ${ROLE_LABEL[c.role]}, ${KIND_LABEL[c.kind]}, 메서드 ${c.methods}${c.fanIn ? `, 다른 패키지에서 ${c.fanIn}번 부름` : ""}`}
                                onFocus={() => setFocusId(c.id)}
                                onClick={() => (c.id === selected ? onOpen(c.id) : onSelect(c.id))}
                              >
                                {c.entryIds.length > 0 && <span className="chip-entry" aria-hidden="true">▶</span>}
                                <Breakable text={c.name} />
                                {c.entryIds.length > 0 && <span className="sr-only">, {guide.noEntries ? "공개 API 투어 있음" : "진입점 있음"}</span>}
                                {how === "callee" && <span className="sr-only">, 고른 클래스가 부름</span>}
                                {how === "caller" && <span className="sr-only">, 고른 클래스를 부름</span>}
                                {how === "impl" && <span className="sr-only">, 고른 타입의 구현</span>}
                              </button>
                            );
                          })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {more && <span className="map-more" aria-hidden="true">열 더 있음 →</span>}
      </div>
    </>
  );
}
