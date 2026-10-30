import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { RepoGuide } from "@callpath/core";
import { KIND_LABEL, ROLE_LABEL, mapColumns, neighbors } from "../guideNav";

interface Props {
  guide: RepoGuide;
  selected: string | null;
  onSelect: (id: string) => void;
  /** 고른 칩을 한 번 더 누르면 코드를 연다 */
  onOpen: (id: string) => void;
  /** 초점을 옮길 칩(패키지 목록, 지도에서 보기). nonce가 바뀔 때마다 옮긴다 */
  focusRequest: { id: string; nonce: number } | null;
}

/** 좁은 칸에서 이름이 단어 경계(OrderEvent|Listener)에서 줄을 바꾸게 한다 */
function breakable(name: string) {
  const parts = name.split(/(?=[A-Z][a-z])|(?<=\.)/);
  return parts.map((p, i) => (i === 0 ? p : [<wbr key={i} />, p]));
}

interface Line {
  key: string;
  d: string;
  kind: "caller" | "callee";
  low: boolean;
}

/**
 * 설계 7단계 3.1 지도. 행은 패키지, 열은 역할인 표에 클래스를 칩으로 놓는다(D17).
 * 고른 칩의 연결만 선으로 잇는다. 칩은 하나만 Tab으로 들어가고 화살표로 옮긴다
 */
export function GuideMap({ guide, selected, onSelect, onOpen, focusRequest }: Props) {
  const cols = useMemo(() => mapColumns(guide), [guide]);
  const byId = useMemo(() => new Map(guide.classes.map((c) => [c.id, c])), [guide]);
  const near = useMemo(() => (selected ? neighbors(guide, selected) : null), [guide, selected]);
  const callers = useMemo(() => new Map(near?.callers.map((n) => [n.node.id, n]) ?? []), [near]);
  const callees = useMemo(() => new Map(near?.callees.map((n) => [n.node.id, n]) ?? []), [near]);
  // 읽는 차례(행, 열, 칩 순)
  const order = useMemo(
    () => guide.packages.flatMap((p) => cols.flatMap((r) => p.classIds.filter((id) => byId.get(id)?.role === r))),
    [guide, cols, byId],
  );
  const [focusId, setFocusId] = useState<string | null>(selected ?? order[0] ?? null);
  useEffect(() => {
    if (selected) setFocusId(selected);
  }, [selected]);

  const inner = useRef<HTMLDivElement>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const [lines, setLines] = useState<Line[]>([]);

  const measure = useCallback(() => {
    const box = inner.current;
    if (!box || !selected || !near) {
      setLines([]);
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
    const out: Line[] = [];
    for (const n of near.callers) {
      const d = path(n.node.id, selected);
      if (d) out.push({ key: `in:${n.node.id}`, d, kind: "caller", low: n.low });
    }
    for (const n of near.callees) {
      const d = path(selected, n.node.id);
      if (d) out.push({ key: `out:${n.node.id}`, d, kind: "callee", low: n.low });
    }
    setLines(out);
  }, [selected, near]);

  useLayoutEffect(() => measure(), [measure, guide]);
  useEffect(() => {
    const box = inner.current;
    if (!box) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  const moveTo = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    const el = chips.current.get(id);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  useEffect(() => {
    if (focusRequest) moveTo(focusRequest.id);
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

  if (guide.classes.length === 0) {
    return <p className="placeholder" data-testid="map-empty">이 시점에는 지도로 그릴 Java, Kotlin 클래스가 없습니다.</p>;
  }
  return (
    <div className="map-scroll" data-testid="guide-map">
      <div className="map-inner" ref={inner}>
        <table className="map-grid" onKeyDown={onKey} aria-label="패키지와 역할 지도" style={{ "--cols": cols.length } as CSSProperties}>
          <colgroup>
            <col className="map-pkg-col" />
            {cols.map((r) => <col key={r} />)}
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
              <tr key={p.name} data-package={p.name}>
                <th scope="row" className="map-pkg" title={p.name || "(기본 패키지)"}>
                  <span className="map-pkg-name">{p.label}</span>
                  <span className="dim">파일 {p.files}</span>
                </th>
                {cols.map((r) => (
                  <td key={r} className="map-cell">
                    <div className="cell-chips">
                    {p.classIds
                      .map((id) => byId.get(id)!)
                      .filter((c) => c.role === r)
                      .map((c) => {
                        const rel = c.id === selected ? "selected" : callees.has(c.id) ? "callee" : callers.has(c.id) ? "caller" : selected ? "dim" : "";
                        return (
                          <button
                            key={c.id}
                            ref={(el) => void (el ? chips.current.set(c.id, el) : chips.current.delete(c.id))}
                            className={`map-chip role-${c.role} ${rel}`}
                            data-class-id={c.id}
                            data-testid="map-chip"
                            tabIndex={c.id === (focusId ?? order[0]) ? 0 : -1}
                            aria-pressed={c.id === selected}
                            title={`${c.name}, ${KIND_LABEL[c.kind]}, 메서드 ${c.methods}${c.fanIn ? `, 다른 패키지에서 ${c.fanIn}번 부름` : ""}`}
                            onFocus={() => setFocusId(c.id)}
                            onClick={() => (c.id === selected ? onOpen(c.id) : onSelect(c.id))}
                          >
                            {c.entryIds.length > 0 && <span className="chip-entry" aria-hidden="true">▶</span>}
                            {breakable(c.name)}
                            {rel === "callee" && <span className="sr-only">, 고른 클래스가 부름</span>}
                            {rel === "caller" && <span className="sr-only">, 고른 클래스를 부름</span>}
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
        <svg className="map-lines" aria-hidden="true">
          <defs>
            <marker id="arrow-callee" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="arrow-callee" />
            </marker>
            <marker id="arrow-caller" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="arrow-caller" />
            </marker>
          </defs>
          {lines.map((l) => (
            <path key={l.key} d={l.d} className={`map-line ${l.kind}${l.low ? " low" : ""}`} markerEnd={`url(#arrow-${l.kind})`} />
          ))}
        </svg>
      </div>
    </div>
  );
}
