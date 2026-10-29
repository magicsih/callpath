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

export type ProviderKindName = "github" | "gitlab";

/** 화면에 보이는 연결. 토큰은 들어 있지 않다 */
export interface ConnectionView {
  id: string;
  kind: ProviderKindName;
  /** 예: github.com, ghe.corp.io, gitlab.com */
  host: string;
  auth: "gh-cli" | "token";
  /** 저장할 때 확인한 사용자 이름 */
  user: string | null;
  /** 이 컴퓨터에 암호 저장소가 없어 토큰을 약하게 보관함(Linux 등) */
  weakStorage: boolean;
}

export interface ConnectionInput {
  kind: ProviderKindName;
  /** 호스트나 주소. 예: github.com, https://ghe.corp.io */
  host: string;
  auth: "gh-cli" | "token";
  token?: string;
}

export interface ConnectionsState {
  connections: ConnectionView[];
  /** 로그인된 gh CLI가 있어 GitHub.com에 쓸 수 있는지 */
  ghCli: boolean;
  /** gh CLI에 로그인된 GitHub.com 계정 이름 */
  ghCliUser: string | null;
  /** Linux에 암호 저장소가 없어 토큰을 약하게 보관하게 되는지 */
  weakStorage: boolean;
}

/** 리뷰 중인 PR. 분석 요청의 repo는 앱 캐시의 bare 저장소이고 base, head는 PR의 커밋이다 */
export interface PrMeta {
  url: string;
  kind: ProviderKindName;
  host: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  startSha?: string;
  /** 앱 캐시의 bare 저장소 */
  gitDir: string;
}

export interface PrProgress {
  url: string;
  step: "info" | "code";
  message: string;
}

export type PrList =
  | { status: "ok"; host: string; prs: Array<{ number: number; title: string; author: string; url: string; updatedAt: string }> }
  | { status: "no-remote" }
  | { status: "needs-connection"; host: string; /** 연결 설정에 넣을 호스트(포트 포함) */ webHost: string; kind: ProviderKindName | null };

/** 읽으면서 남긴 메모. head 쪽 파일의 줄(1부터)에 묶인다 */
export interface Note {
  id: number;
  path: string;
  line: number;
  body: string;
  createdAt: number;
  posted: { url: string; mode: "line" | "general" } | null;
  /** 같은 비교의 이전 커밋에 남긴 메모. 줄이 달라졌을 수 있어 보기와 지우기만 한다 */
  stale: boolean;
}

export interface NoteScope {
  /** 분석 요청의 repo(로컬 저장소 경로나 PR의 bare 저장소) */
  repo: string;
  base: string;
  head: string;
  /** 같은 비교를 알아보는 키. PR이면 PR 주소, 로컬이면 "기준...변경" 브랜치 이름 */
  subject: string;
}

/** 게시 미리보기의 한 줄. line은 PR diff 안의 줄이라 줄 코멘트로, general은 diff 밖이라 위치를 적은 일반 코멘트로 올라간다 */
export interface PostPlan {
  noteId: number;
  mode: "line" | "general";
  path: string;
  line: number;
  /** 실제로 올라갈 본문 */
  body: string;
}

export type PostResult = { noteId: number; ok: true; url: string } | { noteId: number; ok: false; error: string };

/** LLM 설정 화면에 보이는 값. 키와 헤더 값은 돌려주지 않는다 */
export interface LlmSettingsView {
  enabled: boolean;
  endpoint: string;
  model: string;
  hasKey: boolean;
  /** 키를 어디서 읽는지. stored는 앱에 암호화해 둔 키, file은 이 컴퓨터의 키 파일 */
  keySource: "stored" | "file";
  keyFile: { path: string; name: string } | null;
  headerNames: string[];
  /** Linux에 암호 저장소가 없어 키를 약하게 보관하게 되는지 */
  weakStorage: boolean;
  /** 보낸 기록 파일 경로 */
  logPath: string;
}

export interface LlmSettingsInput {
  enabled: boolean;
  endpoint: string;
  model: string;
  /** 넣으면 바꾸고, null이면 지우고, 빼면 그대로 둔다 */
  apiKey?: string | null;
  /** 빼면 지금 방식을 그대로 둔다 */
  keySource?: "stored" | "file";
  keyFile?: { path: string; name: string };
  /** "이름: 값" 줄. 넣으면 바꾸고, null이면 지우고, 빼면 그대로 둔다 */
  headers?: string | null;
}

export interface LlmSaved {
  view: LlmSettingsView;
  /** 저장하며 확인한 결과에 대한 안내(모델 목록을 못 받음, 목록에 없는 모델 등) */
  note: string | null;
}

/** 무엇을 설명받을지. 렌더러가 가진 분석 결과를 그대로 넘긴다 */
export type ExplainTarget =
  | { kind: "flow"; flow: import("@callpath/core").Flow }
  | { kind: "method"; step: import("@callpath/core").Step; callees: string[]; /** 진입점 미확정 묶음의 단계 */ orphan: boolean };

export interface ExplainPreview {
  id: string;
  payload: import("@callpath/llm").ExplainPayload;
  /** 보낼 곳(호스트)과 모델 */
  endpointHost: string;
  model: string;
}

export type LlmEvent = { id: string; type: "chunk"; text: string } | { id: string; type: "thinking" } | { id: string; type: "done" } | { id: string; type: "error"; error: string; kind: string };

export interface UiState {
  recent: string[];
  /** 마지막으로 리뷰 화면에 있던 저장소. 시작 화면으로 나가면 null */
  lastRepo: string | null;
  /** 저장소 경로별 마지막 비교, 위치, 테스트 표시 */
  repos: Record<string, LastReview>;
  /** bare 저장소 경로별 PR 정보. lastRepo가 여기 있으면 PR 리뷰로 복원한다 */
  prs: Record<string, PrMeta>;
  /** 최근 연 PR 주소 */
  recentPrs: Array<{ url: string; title: string }>;
}

/** ref: 비교할 브랜치나 커밋을 못 찾음(비교를 바꿔야 함), path: 경로 문제, auth: 토큰 거부, connection: 연결 설정이 없음, network: 호스트에 닿지 않음 */
export type ErrorKind = "ref" | "path" | "auth" | "connection" | "network" | "input" | "cancelled" | "other";

/** 연결 설정을 열 때 미리 채울 값. PR 주소나 저장소 원격에서 알아낸다 */
export interface ConnectionHint {
  choice: "github.com" | "ghe" | "gitlab";
  /** 입력칸에 넣을 호스트. https가 아니면 scheme까지 */
  host: string;
  /** 제공자를 원격 주소만으로 알 수 없어 사용자가 골라야 함 */
  unsure?: boolean;
}

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
  listConnections(): Promise<ConnectionsState>;
  /** requestId를 주면 cancelConnectionCheck로 기다리던 확인을 멈출 수 있다 */
  saveConnection(input: ConnectionInput, requestId?: string): Promise<Result<ConnectionView>>;
  cancelConnectionCheck(requestId: string): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  /** PR 주소로 PR 정보와 코드를 받는다. 진행은 onPrProgress로 온다 */
  openPullRequest(url: string): Promise<Result<PrMeta>>;
  onPrProgress(cb: (p: PrProgress) => void): () => void;
  /** 로컬 저장소의 원격 주소로 연결을 찾아 열린 PR 목록을 준다 */
  listPullRequests(repoPath: string): Promise<Result<PrList>>;
  openExternal(url: string): Promise<void>;
  getLlmSettings(): Promise<LlmSettingsView>;
  /** 켜면 모델 목록으로 끝점과 키를 확인한 뒤 저장한다(코드는 보내지 않는다) */
  saveLlmSettings(input: LlmSettingsInput, requestId?: string): Promise<Result<LlmSaved>>;
  cancelLlmCheck(requestId: string): Promise<void>;
  /** 보낼 내용을 만든다. 네트워크를 쓰지 않는다 */
  previewExplain(req: { repo: string; base: string; head: string; target: ExplainTarget }): Promise<Result<ExplainPreview>>;
  /** 미리보기에서 확인한 그 내용을 보낸다. 답은 onLlmEvent로 조각씩 온다 */
  sendExplain(id: string): Promise<Result<void>>;
  cancelExplain(id: string): Promise<void>;
  /** 보내지 않고 닫은 미리보기를 버린다 */
  discardExplain(id: string): Promise<void>;
  onLlmEvent(cb: (e: LlmEvent) => void): () => void;
  showLlmLog(): Promise<void>;
  /** 키 파일에서 그 이름의 값을 찾을 수 있는지. 값은 돌려주지 않는다 */
  checkKeyFile(k: { path: string; name: string }): Promise<"found" | "missing-file" | "missing-name">;
  listNotes(scope: NoteScope): Promise<Result<Note[]>>;
  addNote(scope: NoteScope, note: { path: string; line: number; body: string }): Promise<Result<Note>>;
  deleteNote(id: number): Promise<Result<void>>;
  /** PR에 올릴 메모를 줄 코멘트와 일반 코멘트로 나눈다 */
  planPost(pr: PrMeta, noteIds: number[]): Promise<Result<PostPlan[]>>;
  /** 미리보기에서 확인한 메모를 올린다 */
  postNotes(pr: PrMeta, plans: PostPlan[]): Promise<Result<PostResult[]>>;
  /** 정밀 분석 소식을 받는다. 돌려준 함수를 부르면 그만 받는다 */
  onAnalysisEvent(cb: (e: AnalysisEvent) => void): () => void;
  loadState(): Promise<UiState>;
  saveState(state: UiState): Promise<void>;
}

export const EMPTY_STATE: UiState = { recent: [], lastRepo: null, repos: {}, prs: {}, recentPrs: [] };
