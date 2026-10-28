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
  /** HEAD가 커밋을 가리키는지. 브랜치 목록이 비었을 때 커밋이 없는 것과 목록을 못 읽은 것을 나눈다 */
  hasCommits: boolean;
  /** 브랜치 목록을 읽다 난 git 오류 요약 */
  branchError: string | null;
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
  /** 마지막으로 리뷰 화면에 있던 저장소. 시작 화면으로 나가면 null */
  lastRepo: string | null;
  /** 저장소 경로별 마지막 비교, 위치, 테스트 표시 */
  repos: Record<string, LastReview>;
}

/** ref: 비교할 브랜치나 커밋을 못 찾음(비교를 바꿔야 함), path: 경로 문제 */
export type ErrorKind = "ref" | "path" | "other";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; kind: ErrorKind };

/** 빠른 분석 결과를 돌려준 뒤 워커가 이어서 보내는 정밀 분석 소식 */
export type AnalysisEvent =
  | { req: CompareRequest; kind: "status"; message: string }
  | { req: CompareRequest; kind: "precise"; session: ReviewSession }
  | { req: CompareRequest; kind: "precise-error"; error: string };

/** preload가 window.callpath로 노출하는 API */
export interface CallpathApi {
  pickFolder(): Promise<string | null>;
  inspectRepo(path: string): Promise<Result<RepoInfo>>;
  analyze(req: CompareRequest): Promise<Result<ReviewSession>>;
  /** 그 커밋에 파일이 없으면 null */
  readFile(req: FileRequest): Promise<Result<string | null>>;
  /** 정밀 분석 소식을 받는다. 돌려준 함수를 부르면 그만 받는다 */
  onAnalysisEvent(cb: (e: AnalysisEvent) => void): () => void;
  loadState(): Promise<UiState>;
  saveState(state: UiState): Promise<void>;
}

export const EMPTY_STATE: UiState = { recent: [], lastRepo: null, repos: {} };
