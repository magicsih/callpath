import type { Role } from "./config.js";
import type { SymbolRef } from "./types.js";

/** 둘러보기 지도의 열 이름 */
export const ROLE_LABEL: Record<Role, string> = {
  entry: "진입", service: "서비스", integration: "외부 연동", data: "데이터", model: "모델", config: "설정", other: "기타",
};

/** 생성자와 초기화 블록은 이름 대신 종류로 보인다. 화면과 LLM에 보내는 내용이 같은 이름을 쓰게 한 곳에 둔다 */
export function methodLabel(s: SymbolRef): string {
  const cls = s.container?.split(".").pop();
  if (s.name === "constructor" || (cls && s.name === cls)) return "생성자";
  if (s.name === "init") return "init 블록";
  if (s.name === "<spec>") return "스펙 본문";
  return s.name;
}

/** 예: OrderService.placeOrder, OrderService 생성자 */
export function displayName(s: SymbolRef): string {
  const cls = s.container?.split(".").pop();
  const label = methodLabel(s);
  if (!cls) return label;
  return label === s.name ? `${cls}.${label}` : `${cls} ${label}`;
}
