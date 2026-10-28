import type { ReviewSession } from "@callpath/core";

export interface RepoInfo {
  /** 저장소 최상위 경로 */
  path: string;
  name: string;
  branches: string[];
  /** 원격 기본 브랜치(origin/HEAD) 또는 main, master, develop 중 있는 것 */
  defaultBase: string | null;
  /** 현재 체크아웃한 브랜치. 분리된 HEAD면 짧은 SHA */
  current: string | null;
}

export interface CompareRequest {
  repo: string;
  base: string;
  head: string;
}

export interface FileRequest {
  repo: string;
  /** 커밋 SHA */
  ref: string;
  path: string;
}

export interface LastReview extends CompareRequest {
  /** 마지막으로 보던 항목의 키 (nav.ts) */
  selection: string | null;
  showTests: boolean;
}

export interface UiState {
  recent: string[];
  last: LastReview | null;
}

/** ref: 비교할 브랜치나 커밋을 못 찾음(비교를 바꿔야 함), path: 경로 문제 */
export type ErrorKind = "ref" | "path" | "other";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; kind: ErrorKind };

/** preload가 window.callpath로 노출하는 API */
export interface CallpathApi {
  pickFolder(): Promise<string | null>;
  inspectRepo(path: string): Promise<Result<RepoInfo>>;
  analyze(req: CompareRequest): Promise<Result<ReviewSession>>;
  /** 그 커밋에 파일이 없으면 null */
  readFile(req: FileRequest): Promise<Result<string | null>>;
  loadState(): Promise<UiState>;
  saveState(state: UiState): Promise<void>;
}

export const EMPTY_STATE: UiState = { recent: [], last: null };
