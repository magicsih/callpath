import type { ClassNode, RepoGuide, Tour, TourEntry } from "@callpath/core";
import {
  ENTRY_KIND_LABEL, KIND_LABEL, ROLE_LABEL, ancestry, branchText, childSteps, foldName, implementorCallers, implementors, linkNote, neighbors, stepAt,
  stepName, subtypeWord, type Neighbor,
} from "../guideNav";
import { Breakable } from "./Breakable";
import { Icon } from "./Icon";

function NeighborList(props: {
  guide: RepoGuide; title: string; items: Neighbor[]; onSelect: (id: string) => void; testId: string;
  onEmphasis?: (id: string | null) => void;
  /** 구현을 통해 부르는 쪽 */
  via?: Set<string>;
}) {
  const { guide, title, items, onSelect, testId, onEmphasis, via } = props;
  return (
    <>
      <h3 className="pane-title">{title} {items.length}</h3>
      {items.length === 0 ? (
        <p className="muted small">없음</p>
      ) : (
        <ul className="next-steps" data-testid={testId}>
          {items.map((n) => {
            const note = linkNote(guide, n);
            return (
              <li key={n.node.id}>
                <span className="next-line">
                  <button
                    className="link"
                    onClick={() => onSelect(n.node.id)}
                    title={n.node.id}
                    onMouseEnter={() => onEmphasis?.(n.node.id)}
                    onMouseLeave={() => onEmphasis?.(null)}
                    onFocus={() => onEmphasis?.(n.node.id)}
                    onBlur={() => onEmphasis?.(null)}
                  >
                    <Breakable text={n.node.name} />
                  </button>
                  <span className="dim">{n.calls}번</span>
                </span>
                {via?.has(n.node.id) ? <span className="via muted">구현을 통해 부름</span> : note && <span className="via flag-text">{note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** 지도에서 고른 클래스의 맥락(설계 7단계 3.1 오른쪽) */
export function ClassContext(props: {
  guide: RepoGuide;
  node: ClassNode | null;
  /** 투어에 이 클래스가 나오는 진입점. 아직 모르면 null */
  through: string[] | null;
  throughError: string | null;
  onSelect: (id: string) => void;
  onOpenCode: (id: string) => void;
  onStartTour: (entryId: string, classId: string) => void;
  onEmphasis: (id: string | null) => void;
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
  const impls = implementors(guide, node.id);
  // 실제 호출 간선은 구현으로 이어져 있으므로, 구현을 부르는 쪽을 이 타입의 부르는 쪽에 합친다
  const implCallers = implementorCallers(guide, node.id).filter((n) => !near.callers.some((c) => c.node.id === n.node.id));
  const callers = [...near.callers, ...implCallers.map((n) => ({ ...n, low: false }))];
  const via = new Set(implCallers.map((n) => n.node.id));
  const entry = (id: string) => guide.entries.find((e) => e.id === id);
  const declared = node.entryIds.map(entry).filter((e): e is TourEntry => e !== undefined);
  const passing = (props.through ?? []).filter((id) => !node.entryIds.includes(id)).map(entry).filter((e): e is TourEntry => e !== undefined);
  const start = declared[0] ?? passing[0] ?? null;
  const pkg = guide.packages.find((p) => p.name === node.packageName);
  const supers = node.supertypeIds.map((id) => guide.classes.find((c) => c.id === id)).filter((c): c is ClassNode => c !== undefined);
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
      {!start && props.through !== null && (
        <p className="muted small" data-testid="no-tour">
          어느 진입점의 투어에도 나오지 않습니다. 진입점에서 닿지 않거나, 투어가 깊이나 단계 상한에서 잘린 뒤에 불리는 코드일 수 있습니다.
        </p>
      )}
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
                <button className="link" onClick={() => props.onStartTour(e.id, node.id)} title={`${ENTRY_KIND_LABEL[e.kind]} ${e.label}`}><Breakable text={e.label} /></button>
                {node.entryIds.includes(e.id) && <span className="dim">여기서 시작</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {supers.length > 0 && (
        <p className="small muted">
          상위 타입: {supers.map((s, i) => (
            <span key={s.id}>{i > 0 && ", "}<button className="link small" onClick={() => props.onSelect(s.id)}>{s.name}</button></span>
          ))}
        </p>
      )}
      {impls.length > 0 && (
        <>
          <h3 className="pane-title">{node.kind === "interface" ? "구현" : "직접 하위 클래스"} {impls.length}</h3>
          <ul className="next-steps" data-testid="implementors">
            {impls.map((c) => (
              <li key={c.id}><button className="link" onClick={() => props.onSelect(c.id)} title={c.id}>{c.name}</button></li>
            ))}
          </ul>
        </>
      )}
      <NeighborList guide={guide} title="부르는 쪽" items={callers} onSelect={props.onSelect} testId="callers" onEmphasis={props.onEmphasis} via={via} />
      {via.size > 0 && <p className="muted small">이 타입의 메서드를 부르는 호출은 {subtypeWord(node)} 클래스로 이어 두어, 지도에서는 {subtypeWord(node)}으로 선이 갑니다.</p>}
      <NeighborList guide={guide} title="부르는 것" items={near.callees} onSelect={props.onSelect} testId="callees" onEmphasis={props.onEmphasis} />
    </>
  );
}

/** 투어 단계의 호출 스택과 이어지는 단계(설계 7단계 3.2 오른쪽) */
export function TourSide(props: {
  tour: Tour;
  n: number;
  onStep: (n: number) => void;
  onShowOnMap: (classId: string) => void;
  /** 다음 진입점(마지막 단계에서 보인다) */
  nextEntry: TourEntry | null;
  onNextEntry: () => void;
}) {
  const { tour, n } = props;
  const step = stepAt(tour, n);
  if (!step) return null;
  const chain = ancestry(tour, n);
  const children = childSteps(tour, n);
  const back = step.calls.filter((c) => c.back).map((c) => stepAt(tour, c.to)!).filter(Boolean);
  const folded = [...new Set(step.folded.map((f) => foldName(tour, f)))];
  const external = [...new Set(step.external.map((f) => f.name))];
  const last = n === tour.steps.length;
  return (
    <>
      <h2 className="pane-title">호출 스택</h2>
      <ol className="stack" data-testid="tour-stack">
        {chain.map((s, i) => {
          const current = s.n === n;
          return (
            <li key={s.n} className={current ? "current" : ""} style={{ paddingLeft: `${Math.min(i, 8) * 10}px` }}>
              {current ? (
                <span aria-current="step" title={s.symbol.qualifiedName}><Breakable text={stepName(tour, s)} /></span>
              ) : (
                <button className="link" onClick={() => props.onStep(s.n)} title={s.symbol.qualifiedName}><Breakable text={stepName(tour, s)} /></button>
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
                <button className="link" onClick={() => props.onStep(c.n)} title={c.symbol.qualifiedName}>{c.n}단계 <Breakable text={stepName(tour, c)} /></button>
                {i === 0 && <kbd aria-hidden="true">Enter</kbd>}
              </span>
              {branchText(c, true) && <span className="via muted">{branchText(c, true)}</span>}
            </li>
          ))}
        </ul>
      )}
      {last && (
        <div className="tour-end" data-testid="tour-end">
          <p><strong>투어의 마지막 단계입니다.</strong>{tour.truncated ? " 깊이나 단계 상한에서 잘린 가지가 있습니다." : ""}</p>
          {props.nextEntry && <button onClick={props.onNextEntry}>다음 진입점: {props.nextEntry.label}</button>}
        </div>
      )}
      {back.length > 0 && (
        <>
          <h3 className="pane-title">앞 단계를 다시 부름</h3>
          <ul className="next-steps">
            {back.map((b) => (
              <li key={b.n}>
                <button className="link" onClick={() => props.onStep(b.n)}>{b.n}단계 {stepName(tour, b)}</button>
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
            {folded.map((name) => <li key={name}><Breakable text={name} /></li>)}
          </ul>
        </>
      )}
      {external.length > 0 && (
        <>
          <h3 className="pane-title">물려받거나 자동으로 생긴 메서드</h3>
          <p className="muted small">저장소 안 타입에 부르지만 선언이 저장소에 없습니다. JpaRepository의 save 같은 상속 메서드나 record 접근자입니다. 코드 옆에 ↗로 보입니다.</p>
          <ul className="folded" data-testid="tour-external">
            {external.map((name) => <li key={name}><Breakable text={name} /></li>)}
          </ul>
        </>
      )}
      <button className="side-action" onClick={() => props.onShowOnMap(step.classId)} disabled={!step.classId} data-testid="show-on-map">지도에서 보기</button>
    </>
  );
}
