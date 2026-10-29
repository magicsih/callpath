import type { ReactNode } from "react";
import { nextSteps, shortName, stepForStackEntry, type Nav, type NavItem, type StepItem } from "../nav";

/** footer는 오른쪽 영역 맨 아래에 붙는 내용(LLM 버튼) */
export function StackPane({ item, nav, onSelect, footer }: { item: NavItem; nav: Nav; onSelect: (i: NavItem) => void; footer?: ReactNode }) {
  if (item.kind === "file") {
    return (
      <aside className="pane right" aria-label="호출 스택">
        <h2 className="pane-title">파일</h2>
        <p className="muted">
          {item.groupId === "outside" ? "메서드 밖에서 바뀐 곳" : item.groupId === "otherTests" ? "단계에 붙지 않은 테스트 변경" : "바뀐 구간"} {item.file.hunks.length}곳
          {item.groupId !== "nonCode" &&
            `: ${item.file.hunks.map((h) => `${((h.head ?? h.base)!.startLine + 1)}번째 줄`).join(", ")}`}
        </p>
        <p className="muted small">
          {item.groupId === "otherTests"
            ? "바뀐 메서드를 직접 부르지 않는 테스트 코드입니다. 다른 테스트는 각 단계 아래에서 봅니다."
            : "메서드에 속하지 않는 변경이라 호출 스택이 없습니다."}
        </p>
        {footer}
      </aside>
    );
  }
  const step: StepItem | null = item.kind === "step" ? item : (nav.order.find((x) => x.key === item.parentKey) as StepItem | undefined) ?? null;
  if (!step) return <aside className="pane right" aria-label="호출 스택">{footer}</aside>;
  const path = step.step.path;
  const children = nextSteps(step, nav);
  return (
    <aside className="pane right" aria-label="호출 스택">
      <h2 className="pane-title">호출 스택</h2>
      {path.length === 0 ? (
        <p className="muted small">
          {step.step.change === "removed"
            ? "삭제된 메서드라 바뀐 코드에서는 이 메서드를 부르는 곳이 없습니다."
            : "진입점에서 이 메서드까지 닿는 호출을 찾지 못했습니다. 리플렉션, 프레임워크 콜백, 저장소 밖 호출일 수 있습니다."}
        </p>
      ) : (
        <ol className="stack" data-testid="stack">
          {path.map((p, i) => {
            const target = stepForStackEntry(p, step, nav);
            const current = i === path.length - 1;
            const role = i === 0 ? "진입점" : target ? `${target.pos}단계` : "경유";
            return (
              <li key={`${p.qualifiedName}@${p.range.startLine}`} className={`${target ? "" : "transit"}${current ? " current" : ""}`} style={{ paddingLeft: `${Math.min(i, 8) * 10}px` }}>
                {target && !current ? (
                  <button className="link" onClick={() => onSelect(target)} title={p.qualifiedName}>{shortName(p)}</button>
                ) : (
                  <span aria-current={current ? "step" : undefined} title={p.qualifiedName}>{shortName(p)}</span>
                )}
                <span className="role">{role}</span>
              </li>
            );
          })}
        </ol>
      )}
      <h2 className="pane-title">이어지는 단계</h2>
      {children.length === 0 ? (
        <p className="muted small">이 메서드에서 이어지는 바뀐 메서드가 없습니다.</p>
      ) : (
        <ul className="next-steps">
          {children.map(({ item: c, via }, i) => (
            <li key={c.key}>
              <span className="next-line">
                <button className="link" onClick={() => onSelect(c)} title={c.step.symbol.qualifiedName}>
                  {c.pos}단계 {shortName(c.step.symbol)}
                </button>
                {i === 0 && <kbd aria-hidden="true">Enter</kbd>}
              </span>
              {via.length > 0 && <span className="via muted" title={via.map((v) => v.qualifiedName).join(" › ")}>{via.map((v) => shortName(v)).join(" › ")} 경유</span>}
            </li>
          ))}
        </ul>
      )}
      {footer}
    </aside>
  );
}
