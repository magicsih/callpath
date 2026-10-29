import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, GitRefSource, mergeBase } from "@callpath/core";
import { canComment, fetchPullRequestCode, GitHubProvider, GitLabProvider, headRangesFromPatch, parsePrUrl, parseRemote, ProviderError, type Provider } from "../src/index.js";
import { GOOD_TOKEN, makeFixture, startMock, type Fixture, type MockServer } from "./mock.js";

describe("주소 읽기", () => {
  it("GitHub, GHE, GitLab PR 주소", () => {
    expect(parsePrUrl("https://github.com/seorilabs/lucid-chess/pull/32")).toEqual({ kind: "github", host: "github.com", repo: "seorilabs/lucid-chess", number: 32 });
    expect(parsePrUrl("https://github.com/a/b/pull/7/files#diff-1")).toMatchObject({ repo: "a/b", number: 7 });
    expect(parsePrUrl("https://ghe.corp.io/team/svc/pull/3", { github: ["ghe.corp.io"], gitlab: [] })).toMatchObject({ kind: "github", host: "ghe.corp.io", number: 3 });
    expect(parsePrUrl("https://gitlab.com/g/sub/proj/-/merge_requests/12")).toEqual({ kind: "gitlab", host: "gitlab.com", repo: "g/sub/proj", number: 12 });
    expect(parsePrUrl("https://git.corp.io/g/proj/-/merge_requests/5", { github: [], gitlab: ["git.corp.io"] })).toMatchObject({ kind: "gitlab", repo: "g/proj" });
    expect(parsePrUrl("https://unknown.io/a/b/pull/1")).toBeNull();
    expect(parsePrUrl("https://github.com/a/b/issues/1")).toBeNull();
    expect(parsePrUrl("not a url")).toBeNull();
  });

  it("git 원격 주소", () => {
    expect(parseRemote("git@github.com:seorilabs/lucid-chess.git")).toEqual({ host: "github.com", repo: "seorilabs/lucid-chess" });
    expect(parseRemote("https://gitlab.com/g/sub/proj.git")).toEqual({ host: "gitlab.com", repo: "g/sub/proj" });
    expect(parseRemote("ssh://git@ghe.corp.io/team/svc.git")).toEqual({ host: "ghe.corp.io", repo: "team/svc" });
  });

  it("diff hunk에서 head 쪽 줄 범위", () => {
    expect(headRangesFromPatch("@@ -1,3 +1,4 @@\n a\n+b\n c\n d\n@@ -20 +21,0 @@\n-x\n@@ -30,2 +31 @@\n y")).toEqual([{ start: 1, end: 4 }, { start: 31, end: 31 }]);
  });
});

let fx: Fixture;
let mock: MockServer;
const cacheRoots: string[] = [];
beforeAll(async () => {
  fx = makeFixture();
  mock = await startMock(fx);
});
afterAll(async () => {
  await mock.close();
  fx.cleanup();
  for (const d of cacheRoots) rmSync(d, { recursive: true, force: true });
});

const cases: Array<{ name: string; make: (token: string) => Provider; repo: string }> = [
  { name: "GitHub Enterprise(모의)", make: (t) => new GitHubProvider("ghe.test", `${mockUrl()}/api/v3`, async () => t), repo: "shop/order" },
  { name: "GitLab(모의)", make: (t) => new GitLabProvider("gitlab.test", `${mockUrl()}/api/v4`, async () => t), repo: "shop/backend/order" },
];
function mockUrl(): string {
  return mock.url;
}

describe.each(cases)("$name", ({ make, repo }) => {
  it("연결 확인, 목록, PR 정보, 코드 받기와 분석", async () => {
    const p = make(GOOD_TOKEN);
    expect(await p.whoami()).toBe("reviewer");
    expect((await p.listPullRequests(repo)).map((x) => x.number)).toEqual([1]);
    const pr = await p.fetchPullRequest(repo, 1);
    expect(pr).toMatchObject({ baseSha: fx.baseSha, headSha: fx.headSha, baseRef: "main" });
    const cache = mkdtempSync(join(tmpdir(), "callpath-prov-cache-"));
    cacheRoots.push(cache);
    const gitDir = await fetchPullRequestCode(cache, pr, await p.gitAuthHeader());
    // 두 번째로 받으면 이미 받은 이력을 재사용한다
    expect(await fetchPullRequestCode(cache, pr, await p.gitAuthHeader())).toBe(gitDir);
    const base = await mergeBase(gitDir, pr.baseSha, pr.headSha);
    const session = await analyze(new GitRefSource(gitDir, base), new GitRefSource(gitDir, pr.headSha), { repo: gitDir, baseLabel: base, headLabel: pr.headSha });
    expect(session.flows.map((f) => f.label)).toEqual(["POST /orders"]);
  });

  it("diff 안의 줄은 줄 코멘트로 올라가고, 밖의 줄은 거부되며, 일반 코멘트는 어디든 올라가고 지울 수 있다", async () => {
    const p = make(GOOD_TOKEN);
    const pr = await p.fetchPullRequest(repo, 1);
    const ranges = await p.diffRanges(pr);
    const path = "src/main/java/shop/order/OrderService.java";
    const inside = ranges.get(path)![0]!.start;
    expect(canComment(ranges, path, inside)).toBe(true);
    expect(canComment(ranges, path, 1)).toBe(false);
    const line = await p.postLineComment(pr, { path, line: inside, body: "재고 차감이 결제 앞으로 왔습니다" });
    expect(line.mode).toBe("line");
    expect(mock.posted.some((x) => x.kind === "line" && x.line === inside)).toBe(true);
    await expect(p.postLineComment(pr, { path, line: 1, body: "x" })).rejects.toMatchObject({ code: "rejected" });
    const general = await p.postGeneralComment(pr, "`OrderService.java:1` 일반 코멘트");
    await p.deleteComment(pr, line);
    await p.deleteComment(pr, general);
    expect(mock.posted).toHaveLength(0);
  });

  it("잘못된 토큰은 auth 오류이고 문구에 토큰이 없다", async () => {
    const bad = "bad-token-secret-value";
    const p = make(bad);
    const err = await p.whoami().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe("auth");
    expect((err as Error).message).toContain("토큰이 거부되었습니다");
    expect((err as Error).message).not.toContain(bad);
  });
});

describe("코드 받기 실패", () => {
  it("오류 문구에 인증 헤더가 드러나지 않는다", async () => {
    const cache = mkdtempSync(join(tmpdir(), "callpath-prov-cache-"));
    cacheRoots.push(cache);
    const header = "Authorization: Basic c2VjcmV0LXZhbHVl";
    const pr = { kind: "github" as const, host: "x.test", repo: "a/b", number: 1, title: "", url: "", author: "", baseRef: "main", headRef: "f", baseSha: "0".repeat(40), headSha: "1".repeat(40), cloneUrl: join(cache, "no-such-remote.git"), fetchRef: "refs/pull/1/head" };
    const err = (await fetchPullRequestCode(cache, pr, header).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("코드를 받지 못했습니다");
    expect(err.message).not.toContain("c2VjcmV0LXZhbHVl");
  });
});

describe("리뷰 지적 회귀", () => {
  it("열린 PR이 100개를 넘어도 모두 읽는다", async () => {
    const p = new GitHubProvider("ghe.test", `${mockUrl()}/api/v3`, async () => GOOD_TOKEN);
    expect(await p.listPullRequests("shop/many")).toHaveLength(120);
  });

  it("JSON이 아닌 성공 응답은 원인을 담은 제공자 오류다", async () => {
    const p = new GitHubProvider("ghe.test", `${mockUrl()}/api/v3`, async () => GOOD_TOKEN);
    const err = await p.fetchPullRequest("shop/html", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toContain("API가 아닌 응답");
  });

  it("포트가 붙은 ssh 주소와 scp 형식 주소", () => {
    expect(parseRemote("ssh://git@git.corp.io:2222/team/svc.git")).toEqual({ host: "git.corp.io", repo: "team/svc" });
    expect(parseRemote("git@git.corp.io:team/svc.git")).toEqual({ host: "git.corp.io", repo: "team/svc" });
  });

  it("base 브랜치가 지워진 PR도 head와 base 커밋으로 코드를 받는다", async () => {
    const p = new GitHubProvider("ghe.test", `${mockUrl()}/api/v3`, async () => GOOD_TOKEN);
    const pr = { ...(await p.fetchPullRequest("shop/order", 1)), baseRef: "deleted-branch" };
    const cache = mkdtempSync(join(tmpdir(), "callpath-prov-cache-"));
    cacheRoots.push(cache);
    const gitDir = await fetchPullRequestCode(cache, pr, await p.gitAuthHeader());
    expect(await mergeBase(gitDir, pr.baseSha, pr.headSha)).toBe(pr.baseSha);
  });
});

describe("연결 실패 이유", () => {
  it("연결을 거부한 호스트는 network 오류이고 이유를 한국어로 알린다", async () => {
    // 잠깐 열었다 닫은 포트는 연결을 거부한다
    const { createServer } = await import("node:http");
    const s = createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    const port = (s.address() as { port: number }).port;
    await new Promise((r) => s.close(r));
    const p = new GitHubProvider(`127.0.0.1:${port}`, `http://127.0.0.1:${port}/api/v3`, async () => "t");
    const err = (await p.whoami().catch((e: unknown) => e)) as ProviderError;
    expect(err.code).toBe("network");
    expect(err.message).toContain("호스트가 연결을 거부했습니다");
  });

  it("응답을 기다리는 중에 멈추면 cancelled로 끝난다", async () => {
    const { createServer } = await import("node:http");
    // 요청을 받고 답하지 않는 서버
    const server = createServer(() => undefined);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const p = new GitLabProvider(`127.0.0.1:${port}`, `http://127.0.0.1:${port}/api/v4`, async () => "t");
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 200);
      const started = Date.now();
      const err = (await p.whoami(ctl.signal).catch((e: unknown) => e)) as ProviderError;
      expect(err.code).toBe("cancelled");
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe("서버 오류", () => {
  it("5xx는 토큰 문제처럼 보이지 않게 서버 오류로 알린다", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.statusCode = 502;
      res.end("<html>Bad Gateway</html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const p = new GitHubProvider(`127.0.0.1:${port}`, `http://127.0.0.1:${port}/api/v3`, async () => "t");
      const err = (await p.whoami().catch((e: unknown) => e)) as ProviderError;
      expect(err.code).toBe("other");
      expect(err.message).toContain("서버에 오류가 났습니다");
      expect(err.message).not.toContain("거부");
    } finally {
      server.close();
    }
  });
});
