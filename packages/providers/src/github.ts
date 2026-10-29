import { headRangesFromPatch, request, type TokenSource } from "./http.js";
import type { DiffRanges, LineComment, PostedComment, Provider, PullRequestInfo, PullRequestSummary } from "./types.js";

interface GhPull {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  user: { login: string } | null;
  base: { ref: string; sha: string; repo: { clone_url: string } };
  head: { ref: string; sha: string };
}

/** GitHub.com과 GitHub Enterprise. GHE는 apiBase만 https://<호스트>/api/v3로 다르다 */
export class GitHubProvider implements Provider {
  readonly kind = "github" as const;

  constructor(
    readonly host: string,
    private readonly apiBase: string,
    private readonly token: TokenSource,
  ) {}

  static forHost(host: string, token: TokenSource): GitHubProvider {
    return new GitHubProvider(host, host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`, token);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    const token = await this.token();
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    if (token) headers.authorization = `Bearer ${token}`;
    return request<T>(method, `${this.apiBase}${path}`, headers, token, body);
  }

  private async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 30; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const { data } = await this.call<T[]>("GET", `${path}${sep}per_page=100&page=${page}`);
      out.push(...data);
      if (data.length < 100) break;
    }
    return out;
  }

  async whoami(): Promise<string> {
    return (await this.call<{ login: string }>("GET", "/user")).data.login;
  }

  async listPullRequests(repo: string): Promise<PullRequestSummary[]> {
    const { data } = await this.call<GhPull[]>("GET", `/repos/${repo}/pulls?state=open&per_page=50&sort=updated`);
    return data.map((p) => ({ number: p.number, title: p.title, author: p.user?.login ?? "", url: p.html_url, updatedAt: p.updated_at }));
  }

  async fetchPullRequest(repo: string, number: number): Promise<PullRequestInfo> {
    const { data: p } = await this.call<GhPull>("GET", `/repos/${repo}/pulls/${number}`);
    return {
      kind: "github", host: this.host, repo, number,
      title: p.title, url: p.html_url, author: p.user?.login ?? "",
      baseRef: p.base.ref, headRef: p.head.ref, baseSha: p.base.sha, headSha: p.head.sha,
      cloneUrl: p.base.repo.clone_url, fetchRef: `refs/pull/${number}/head`,
    };
  }

  async diffRanges(pr: PullRequestInfo): Promise<DiffRanges> {
    const files = await this.all<{ filename: string; patch?: string }>(`/repos/${pr.repo}/pulls/${pr.number}/files`);
    return new Map(files.map((f) => [f.filename, f.patch ? headRangesFromPatch(f.patch) : []]));
  }

  async postLineComment(pr: PullRequestInfo, c: LineComment): Promise<PostedComment> {
    const { data } = await this.call<{ id: number; html_url: string }>("POST", `/repos/${pr.repo}/pulls/${pr.number}/comments`, {
      body: c.body, commit_id: pr.headSha, path: c.path, line: c.line, side: "RIGHT",
    });
    return { id: String(data.id), url: data.html_url, mode: "line" };
  }

  async postGeneralComment(pr: PullRequestInfo, body: string): Promise<PostedComment> {
    const { data } = await this.call<{ id: number; html_url: string }>("POST", `/repos/${pr.repo}/issues/${pr.number}/comments`, { body });
    return { id: String(data.id), url: data.html_url, mode: "general" };
  }

  async deleteComment(pr: PullRequestInfo, posted: PostedComment): Promise<void> {
    const path = posted.mode === "line" ? `/repos/${pr.repo}/pulls/comments/${posted.id}` : `/repos/${pr.repo}/issues/comments/${posted.id}`;
    await this.call("DELETE", path);
  }

  async gitAuthHeader(): Promise<string | null> {
    const token = await this.token();
    return token ? `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` : null;
  }
}
