import type { ClassNode, RepoGuide, Tour, TourEntry } from "@callpath/core";
import { ENTRY_KIND_LABEL, KIND_LABEL, ROLE_LABEL, ancestry, childSteps, neighbors, stepAt, stepLabel, type Neighbor } from "../guideNav";
import { Icon } from "./Icon";

function NeighborList({ title, items, onSelect, testId }: { title: string; items: Neighbor[]; onSelect: (id: string) => void; testId: string }) {
  return (
    <>
      <h3 className="pane-title">{title} {items.length}</h3>
      {items.length === 0 ? (
        <p className="muted small">없음</p>
      ) : (
        <ul className="next-steps" data-testid={testId}>
          {items.map((n) => (
            <li key={n.node.id}>
              <span className="next-line">
                <button className="link" onClick={() => onSelect(n.node.id)} title={n.node.id}>{n.node.name}</button>
                <span className="dim">{n.calls}번</span>
                {n.low && <span className="flag low">이름으로 이음</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 지도에서 고른 클래스의 맥락(설계 7단계 3.1 오른쪽) */
export function ClassContext(props: {
  guide: RepoGuide;
  node: ClassNode | null;
  /** 투어 단계에 이 클래스가 나오는 진입점. 아직 모르면 null */
  through: string[] | null;
  throughError: string | null;
  onSelect: (id: string) => void;
  onOpenCode: (id: string) => void;
  onStartTour: (entryId: string, classId: string) => void;
}) {
  const { guide, node } = props;
  if (!node) {
    return (
      <>
        <h2 className="pane-title">맥락</h2>
        <p className="muted small">지도에서 클래스를 고르면 부르는 쪽, 부르는 것, 이 클래스를 지나는 진입점이 보입니다. 고른 칩을 한 번 더 누르면 코드를 엽니다.</p>
      </>
    );
  }
  const near = neighbors(guide, node.id);
  const entry = (id: string) => guide.entries.find((e) => e.id === id);
  const declared = node.entryIds.map(entry).filter((e): e is TourEntry => e !== undefined);
  const passing = (props.through ?? []).filter((id) => !node.entryIds.includes(id)).map(entry).filter((e): e is TourEntry => e !== undefined);
  const start = declared[0] ?? passing[0] ?? null;
  const pkg = guide.packages.find((p) => p.name === node.packageName);
  return (
    <>
      <h2 className="pane-title class-title" title={node.id} data-testid="context-title">{node.name}</h2>
      <p className="small muted">
        {pkg?.label ?? node.packageName}, {ROLE_LABEL[node.role]}, {KIND_LABEL[node.kind]}
      </p>
      <p className="small muted">메서드 {node.methods}{node.tests ? `, 이 클래스를 부르는 테스트 ${node.tests}` : ""}</p>
      {node.role === "other" && <p className="small muted">역할 규칙에 맞지 않아 기타에 두었습니다. <code>.callpath.yml</code>의 roles로 정할 수 있습니다.</p>}
      <div className="row wrap">
        <button className="primary" disabled={!start} onClick={() => start && props.onStartTour(start.id, node.id)} data-testid="start-tour">
          <Icon name="next" /> 여기서 투어 시작
        </button>
        <button onClick={() => props.onOpenCode(node.id)}>코드 보기</button>
      </div>
      {!start && props.through !== null && <p className="muted small">이 클래스를 지나는 진입점이 없습니다. 진입점 규칙에 맞는 메서드에서 닿지 않는 코드입니다.</p>}
      <h3 className="pane-title">이 클래스를 지나는 진입점</h3>
      {props.throughError ? (
        <p className="error-text small"><Icon name="warn" /> {props.throughError}</p>
      ) : props.through === null ? (
        <p className="muted small" role="status">찾는 중</p>
      ) : declared.length + passing.length === 0 ? (
        <p className="muted small">없음</p>
      ) : (
        <ul className="next-steps" data-testid="context-entries">
          {[...declared, ...passing].map((e) => (
            <li key={e.id}>
              <span className="next-line">
                <button className="link" onClick={() => props.onStartTour(e.id, node.id)} title={`${ENTRY_KIND_LABEL[e.kind]} ${e.label}`}>{e.label}</button>
                {node.entryIds.includes(e.id) && <span className="dim">여기서 시작</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <NeighborList title="부르는 쪽" items={near.callers} onSelect={props.onSelect} testId="callers" />
      <NeighborList title="부르는 것" items={near.callees} onSelect={props.onSelect} testId="callees" />
    </>
  );
}

/** 투어 단계의 호출 스택과 이어지는 단계(설계 7단계 3.2 오른쪽) */
export function TourSide(props: { tour: Tour; n: number; onStep: (n: number) => void; onShowOnMap: (classId: string) => void }) {
  const { tour, n } = props;
  const step = stepAt(tour, n);
  if (!step) return null;
  const chain = ancestry(tour, n);
  const children = childSteps(tour, n);
  const back = step.calls.filter((c) => c.back).map((c) => stepAt(tour, c.to)!).filter(Boolean);
  const folded = [...new Set(step.folded.map((f) => f.name))];
  return (
    <>
      <h2 className="pane-title">호출 스택</h2>
      <ol className="stack" data-testid="tour-stack">
        {chain.map((s, i) => {
          const current = s.n === n;
          return (
            <li key={s.n} className={current ? "current" : ""} style={{ paddingLeft: `${Math.min(i, 8) * 10}px` }}>
              {current ? (
                <span aria-current="step" title={s.symbol.qualifiedName}>{stepLabel(s)}</span>
              ) : (
                <button className="link" onClick={() => props.onStep(s.n)} title={s.symbol.qualifiedName}>{stepLabel(s)}</button>
              )}
              <span className="role">{i === 0 ? "진입점" : `${s.n}단계`}</span>
            </li>
          );
        })}
      </ol>
      <h2 className="pane-title">이어지는 단계</h2>
      {children.length === 0 ? (
        <p className="muted small">이 메서드에서 이어지는 새 단계가 없습니다.</p>
      ) : (
        <ul className="next-steps" data-testid="tour-next">
          {children.map(({ step: c }, i) => (
            <li key={c.n}>
              <span className="next-line">
                <button className="link" onClick={() => props.onStep(c.n)} title={c.symbol.qualifiedName}>{c.n}단계 {stepLabel(c)}</button>
                {i === 0 && <kbd aria-hidden="true">Enter</kbd>}
              </span>
              {c.alternatives > 1 && <span className="via muted">구현 {c.alternatives}개 중 하나</span>}
            </li>
          ))}
        </ul>
      )}
      {back.length > 0 && (
        <>
          <h3 className="pane-title">앞 단계를 다시 부름</h3>
          <ul className="next-steps">
            {back.map((b) => (
              <li key={b.n}>
                <button className="link" onClick={() => props.onStep(b.n)}>{b.n}단계 {stepLabel(b)}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {folded.length > 0 && (
        <>
          <h3 className="pane-title">접은 메서드</h3>
          <p className="muted small">한 문장짜리 메서드와 생성자는 단계로 세지 않습니다.</p>
          <ul className="folded" data-testid="tour-folded">
            {folded.map((name) => <li key={name}>{name}</li>)}
          </ul>
        </>
      )}
      <button className="side-action" onClick={() => props.onShowOnMap(step.classId)} disabled={!step.classId} data-testid="show-on-map">지도에서 보기</button>
    </>
  );
}
