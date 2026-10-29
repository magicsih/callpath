export type ProviderKind = "github" | "gitlab";

/** PR(GitLab은 Merge Request)을 가리키는 값 */
export interface PullRequestRef {
  kind: ProviderKind;
  host: string;
  /** GitHub: owner/repo, GitLab: group/subgroup/project */
  repo: string;
  number: number;
}

export interface PullRequestInfo extends PullRequestRef {
  title: string;
  url: string;
  author: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  /** GitLab 줄 코멘트에 필요한 diff 시작 커밋 */
  startSha?: string;
  cloneUrl: string;
  /** 코드를 받을 PR head ref. 예: refs/pull/12/head */
  fetchRef: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  url: string;
  updatedAt: string;
}

/** 경로별로 줄 코멘트를 달 수 있는 head 쪽 줄 범위(1부터, 끝 포함) */
export type DiffRanges = Map<string, Array<{ start: number; end: number }>>;

export interface PostedComment {
  id: string;
  url: string;
  /** line: 줄 코멘트, general: 일반 코멘트 */
  mode: "line" | "general";
}

export interface LineComment {
  path: string;
  /** head 쪽 줄(1부터) */
  line: number;
  body: string;
}

export interface Provider {
  readonly kind: ProviderKind;
  readonly host: string;
  /** 연결 확인. 토큰 주인의 사용자 이름 */
  whoami(): Promise<string>;
  listPullRequests(repo: string): Promise<PullRequestSummary[]>;
  fetchPullRequest(repo: string, number: number): Promise<PullRequestInfo>;
  diffRanges(pr: PullRequestInfo): Promise<DiffRanges>;
  postLineComment(pr: PullRequestInfo, c: LineComment): Promise<PostedComment>;
  postGeneralComment(pr: PullRequestInfo, body: string): Promise<PostedComment>;
  deleteComment(pr: PullRequestInfo, posted: PostedComment): Promise<void>;
  /** git이 코드를 받을 때 쓸 인증 헤더. 토큰이 없으면 null */
  gitAuthHeader(): Promise<string | null>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: "auth" | "not-found" | "network" | "rejected" | "other",
  ) {
    super(message);
  }
}
