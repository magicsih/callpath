import type { Language, ReviewSession } from "@callpath/core";
import { Icon } from "./Icon";

export type PreciseView = { running: boolean; message: string | null; error: string | null };

const LANG: Record<Language, string> = { java: "Java", kotlin: "Kotlin" };

/** 상단 바의 정밀 분석 상태 표시 */
export function PreciseChip({ session, view }: { session: ReviewSession; view: PreciseView }) {
  const a = session.analysis;
  const langs = Object.entries(a.languages) as Array<[Language, NonNullable<ReviewSession["analysis"]["languages"][Language]>]>;
  // 정밀 분석할 바뀐 메서드가 없으면 보일 것이 없다
  if (!view.running && !view.error && a.precise !== "pending" && langs.length === 0) return null;
  if (view.running && a.precise === "pending") {
    return (
      <span className="pchip running" role="status" data-testid="precise-chip" title={view.message ?? "정밀 분석 중"}>
        <span className="spinner small" aria-hidden="true" />정밀 분석 중{view.message ? <span className="sr-only">: {view.message}</span> : null}
      </span>
    );
  }
  if (a.precise === "done") {
    const detail = langs.filter(([, l]) => l.status === "done").map(([k, l]) => `${LANG[k]} 바뀐 메서드 ${l.queried ?? 0}개, 확인한 연결 ${l.confirmedEdges ?? 0}개`).join(". ");
    const partial = langs.some(([, l]) => l.status !== "done" && l.code !== "disabled");
    return (
      <span className="pchip done" data-testid="precise-chip" title={detail}>
        <Icon name="check" size={12} />{partial ? "정밀 분석 일부 완료" : "정밀 분석 완료"}
      </span>
    );
  }
  if (a.precise === "skipped" && langs.length > 0 && langs.every(([, l]) => l.code === "disabled")) {
    return <span className="pchip off" data-testid="precise-chip">정밀 분석 꺼짐</span>;
  }
  if (a.precise === "pending" && !view.error) return null;
  return (
    <span className="pchip none" data-testid="precise-chip" title="이름으로 이은 연결만 씁니다">
      정밀 분석 없음
    </span>
  );
}

/** 도구가 없거나 실패한 언어를 알리는 띠. 끈 경우에는 띄우지 않는다 */
export function PreciseBanner({ session, view, onDismiss }: { session: ReviewSession; view: PreciseView; onDismiss: () => void }) {
  const a = session.analysis;
  const problems = (Object.entries(a.languages) as Array<[Language, NonNullable<ReviewSession["analysis"]["languages"][Language]>]>)
    .filter(([, l]) => l.status === "failed" || (l.status === "skipped" && l.code !== "disabled"))
    .map(([k, l]) => `${LANG[k]}: ${l.reason ?? "정밀 분석을 하지 못했습니다"}`);
  if (view.error) problems.push(`정밀 분석 오류: ${view.error}`);
  if (problems.length === 0) return null;
  return (
    <div className="banner low precise-banner" role="status" data-testid="precise-banner">
      <Icon name="link" />
      <div className="pb-text">
        <strong>정밀 분석을 하지 못한 언어가 있습니다</strong>
        {problems.map((p) => (
          <span key={p} className="pb-line">{p}</span>
        ))}
        <span className="muted">이 언어의 호출은 이름으로 이었습니다. 후보가 여럿이면 "연결 불확실"로 보입니다.</span>
      </div>
      <button className="link" onClick={onDismiss}>닫기</button>
    </div>
  );
}
