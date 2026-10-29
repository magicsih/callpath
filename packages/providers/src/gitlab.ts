import { headRangesFromPatch, request, type TokenSource } from "./http.js";
import type { DiffRanges, LineComment, PostedComment, Provider, PullRequestInfo, PullRequestSummary } from "./types.js";

interface GlMr {
  iid: number;
  title: string;
  web_url: string;
  updated_at: string;
  author: { username: string } | null;
  source_branch: string;
  target_branch: string;
  sha: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string } | null;
}

/** GitLab.com과 자체 호스팅 GitLab. apiBase는 https://<호스트>/api/v4 */
export class GitLabProvider implements Provider {
  readonly kind = "gitlab" as const;

  constructor(
    readonly host: string,
    private readonly apiBase: string,
    private readonly token: TokenSource,
  ) {}

  static forHost(host: string, token: TokenSource): GitLabProvider {
    return new GitLabProvider(host, `https://${host}/api/v4`, token);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    const token = await this.token();
    const headers: Record<string, string> = token ? { "private-token": token } : {};
    return request<T>(method, `${this.apiBase}${path}`, headers, token, body);
  }

  private project(repo: string): string {
    return `/projects/${encodeURIComponent(repo)}`;
  }

  async whoami(): Promise<string> {
    return (await this.call<{ username: string }>("GET", "/user")).data.username;
  }

  async listPullRequests(repo: string): Promise<PullRequestSummary[]> {
    const { data } = await this.call<GlMr[]>("GET", `${this.project(repo)}/merge_requests?state=opened&per_page=50&order_by=updated_at`);
    return data.map((m) => ({ number: m.iid, title: m.title, author: m.author?.username ?? "", url: m.web_url, updatedAt: m.updated_at }));
  }

  async fetchPullRequest(repo: string, number: number): Promise<PullRequestInfo> {
    const [{ data: m }, { data: p }] = await Promise.all([
      this.call<GlMr>("GET", `${this.project(repo)}/merge_requests/${number}`),
      this.call<{ http_url_to_repo: string }>("GET", this.project(repo)),
    ]);
    const refs = m.diff_refs;
    if (!refs) throw new Error("Merge Request의 diff 정보가 아직 준비되지 않았습니다");
    return {
      kind: "gitlab", host: this.host, repo, number,
      title: m.title, url: m.web_url, author: m.author?.username ?? "",
      baseRef: m.target_branch, headRef: m.source_branch, baseSha: refs.base_sha, headSha: refs.head_sha, startSha: refs.start_sha,
      cloneUrl: p.http_url_to_repo, fetchRef: `refs/merge-requests/${number}/head`,
    };
  }

  async diffRanges(pr: PullRequestInfo): Promise<DiffRanges> {
    const out: DiffRanges = new Map();
    for (let page = 1; page <= 30; page++) {
      const { data } = await this.call<Array<{ new_path: string; diff: string }>>("GET", `${this.project(pr.repo)}/merge_requests/${pr.number}/diffs?per_page=100&page=${page}`);
      for (const f of data) out.set(f.new_path, headRangesFromPatch(f.diff));
      if (data.length < 100) break;
    }
    return out;
  }

  async postLineComment(pr: PullRequestInfo, c: LineComment): Promise<PostedComment> {
    const { data } = await this.call<{ id: string; notes: Array<{ id: number }> }>("POST", `${this.project(pr.repo)}/merge_requests/${pr.number}/discussions`, {
      body: c.body,
      position: { position_type: "text", base_sha: pr.baseSha, start_sha: pr.startSha ?? pr.baseSha, head_sha: pr.headSha, new_path: c.path, old_path: c.path, new_line: c.line },
    });
    const noteId = data.notes[0]?.id;
    return { id: String(noteId), url: `${pr.url}#note_${noteId}`, mode: "line" };
  }

  async postGeneralComment(pr: PullRequestInfo, body: string): Promise<PostedComment> {
    const { data } = await this.call<{ id: number }>("POST", `${this.project(pr.repo)}/merge_requests/${pr.number}/notes`, { body });
    return { id: String(data.id), url: `${pr.url}#note_${data.id}`, mode: "general" };
  }

  async deleteComment(pr: PullRequestInfo, posted: PostedComment): Promise<void> {
    await this.call("DELETE", `${this.project(pr.repo)}/merge_requests/${pr.number}/notes/${posted.id}`);
  }

  async gitAuthHeader(): Promise<string | null> {
    const token = await this.token();
    return token ? `Authorization: Basic ${Buffer.from(`oauth2:${token}`).toString("base64")}` : null;
  }
}
