import type { ReviewSession } from "@callpath/core";
import { CHANGE_LABEL, shortName, type FileItem, type GroupKind, type Nav, type NavItem, type StepItem, type TestItem } from "../nav";
import { Icon } from "./Icon";

const KIND_LABEL: Record<GroupKind, string> = {
  http: "HTTP 진입점", message: "메시지 진입점", schedule: "스케줄 진입점", event: "이벤트 진입점", grpc: "gRPC 진입점", main: "main 진입점",
  unknown: "진입점", orphans: "진입점에서 닿지 않는 변경", outside: "메서드 밖 변경", otherTests: "단계에 붙지 않은 테스트", nonCode: "코드 밖 파일",
};
const STATUS_LABEL = { added: "추가", removed: "삭제", modified: "수정" } as const;

interface Props {
  nav: Nav;
  session: ReviewSession;
  selectedKey: string | null;
  showTests: boolean;
  onSelect: (item: NavItem) => void;
  onToggleTests: () => void;
  registerRow: (key: string, el: HTMLButtonElement | null) => void;
}

export function FlowList({ nav, session, selectedKey, showTests, onSelect, onToggleTests, registerRow }: Props) {
  const flowLabel = new Map(session.flows.map((f) => [f.id, f.label]));
  const rowProps = (item: NavItem) => ({
    ref: (el: HTMLButtonElement | null) => registerRow(item.key, el),
    "aria-current": item.key === selectedKey ? ("true" as const) : undefined,
    className: `row${item.key === selectedKey ? " selected" : ""}`,
    onClick: () => onSelect(item),
    "data-key": item.key,
  });

  const stepRow = (item: StepItem) => {
    const s = item.step;
    const moved = (s.callOrderDiff?.moved.length ?? 0) > 0;
    const ref = s.refOf ? `${flowLabel.get(s.refOf.flow) ?? s.refOf.flow} ${s.refOf.n}단계 참조` : null;
    return (
      <button {...rowProps(item)} data-testid="step-row">
        <span className="line1">
          <span className="num" aria-label={`${item.pos}단계`}>{item.pos}</span>
          <span className="name" title={s.symbol.qualifiedName}>
            <span className="method">{s.symbol.name}</span>
            {s.symbol.container && <span className="cls"> {s.symbol.container.split(".").pop()}</span>}
          </span>
          <span className={`chip change-${s.change}`}>{CHANGE_LABEL[s.change]}</span>
        </span>
        {(moved || s.confidence === "low" || ref) && (
          <span className="line2">
            {moved && <span className="flag warn"><Icon name="warn" size={12} />순서 변경</span>}
            {s.confidence === "low" && <span className="flag low"><Icon name="link" size={12} />연결 불확실</span>}
            {ref && <span className="flag ref">{ref}</span>}
          </span>
        )}
      </button>
    );
  };

  const fileRow = (item: FileItem) => {
    const parts = item.file.path.split("/");
    return (
      <button {...rowProps(item)} data-testid="file-row">
        <span className="line1">
          <span className="name">{parts.pop()}</span>
          <span className="chip">{STATUS_LABEL[item.file.status]}</span>
        </span>
        <span className="line2 dim">{parts.join("/")}</span>
      </button>
    );
  };

  const testRow = (item: TestItem) => (
    <button {...rowProps(item)} data-testid="test-row">
      <span className="line1">
        <Icon name="test" size={12} />
        <span className="name">{item.test.symbol.name.replace(/`/g, "")}</span>
        {item.test.changed && <span className="chip change-body">바뀜</span>}
      </span>
      {item.test.confidence === "low" && <span className="line2"><span className="flag low">연결 불확실</span></span>}
    </button>
  );

  return (
    <nav className="pane left" aria-label="흐름 목록">
      <div className="list-scroll">
        {nav.groups.map((g) => (
          <section key={g.id} className="group" aria-labelledby={`g-${g.id}`}>
            <h2 id={`g-${g.id}`} className={`group-title kind-${g.kind}`} title={KIND_LABEL[g.kind]}>
              <Icon name={g.kind} />
              <span className="sr-only">{KIND_LABEL[g.kind]}: </span>
              <span className="glabel">{g.label}</span>
              <span className="count" aria-label={`${g.items.length}개`}>{g.items.length}</span>
            </h2>
            <ul>
              {g.items.map((item) => (
                <li key={item.key}>
                  {item.kind === "step" ? stepRow(item) : fileRow(item)}
                  {showTests && item.kind === "step" && (nav.testsOf.get(item.key) ?? []).length > 0 && (
                    <ul className="tests" aria-label={`${shortName(item.step.symbol)}를 부르는 테스트`}>
                      {(nav.testsOf.get(item.key) ?? []).map((t) => <li key={t.key}>{testRow(t)}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <label className="tests-toggle">
        <input type="checkbox" checked={showTests} onChange={onToggleTests} />
        <span>테스트 표시</span>
        <kbd aria-hidden="true">t</kbd>
        {!showTests && nav.hiddenTestFiles > 0 && <span className="muted" data-testid="hidden-tests">숨긴 테스트 파일 {nav.hiddenTestFiles}개</span>}
      </label>
    </nav>
  );
}
