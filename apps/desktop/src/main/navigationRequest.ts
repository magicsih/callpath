import { isAbsolute } from "node:path";
import type { NavigationQuery } from "@callpath/core";
import type { GuideTarget } from "../shared/api";

export function validateNavigation(target: GuideTarget, query: NavigationQuery): void {
  const relative = (p: unknown) => typeof p === "string" && p.length > 0 && !/[\x00-\x1f\\]/.test(p) && !isAbsolute(p) && p.split("/").every(s => s !== ".." && s !== "." && s !== "");
  if (!target || typeof target.repo !== "string" || !isAbsolute(target.repo) || target.repo.includes("\0") || typeof target.sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(target.sha) || target.dir !== null && !relative(target.dir)) throw new Error("탐색할 저장소와 커밋, 디렉터리를 확인하세요.");
  if (!query || typeof query !== "object") throw new Error("탐색 요청이 올바르지 않습니다.");
  if (query.kind === "search") {
    if (typeof query.query === "string" && query.query.length <= 500 && (query.limit === undefined || Number.isInteger(query.limit) && query.limit > 0 && query.limit <= 100000)) return;
  } else if (query.kind === "parents" || query.kind === "implementors") {
    if (typeof query.id === "string" && query.id.length > 0 && !query.id.includes("\0")) return;
  } else if (query.kind === "definition" || query.kind === "implementations") {
    if (relative(query.path) && query.position && [query.position.line, query.position.column].every(p => Number.isInteger(p) && p >= 0)) return;
  }
  throw new Error("탐색할 파일과 코드 위치, 검색어를 확인하세요.");
}
