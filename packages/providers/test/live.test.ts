import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, GitRefSource, mergeBase } from "@callpath/core";
import { canComment, fetchPullRequestCode, ghCliToken, GitHubProvider, parsePrUrl } from "../src/index.js";

/**
 * A9 실제 PR 확인. CI에서는 돌지 않고 작성자가 한 번 실행한다(설계 테스트 계획 A9).
 * CALLPATH_LIVE_PR=<PR 주소>로 읽기를, CALLPATH_LIVE_POST=1을 더하면 줄 코멘트를 올리고 바로 지운다.
 */
const LIVE = process.env.CALLPATH_LIVE_PR;

describe.skipIf(!LIVE)("실제 GitHub PR (A9)", () => {
  it("PR 정보, diff 범위, 코드 받기, 분석, 그리고 선택적으로 줄 코멘트 게시와 삭제", async () => {
    const ref = parsePrUrl(LIVE!)!;
    expect(ref?.kind).toBe("github");
    const provider = GitHubProvider.forHost(ref.host, () => ghCliToken(ref.host));
    const me = await provider.whoami();
    const pr = await provider.fetchPullRequest(ref.repo, ref.number);
    const ranges = await provider.diffRanges(pr);
    const cache = mkdtempSync(join(tmpdir(), "callpath-live-"));
    try {
      const gitDir = await fetchPullRequestCode(cache, pr, await provider.gitAuthHeader());
      const base = await mergeBase(gitDir, pr.baseSha, pr.headSha);
      const session = await analyze(new GitRefSource(gitDir, base), new GitRefSource(gitDir, pr.headSha), { repo: gitDir, baseLabel: base, headLabel: pr.headSha });
      const changed = [...session.nonCode, ...session.outsideMethods, ...session.otherTests].map((f) => f.path).concat(session.orphans.map((s) => s.symbol.path), session.flows.flatMap((f) => f.steps.map((s) => s.symbol.path)));
      console.log(JSON.stringify({ user: me, pr: pr.url, base: pr.baseSha.slice(0, 7), mergeBase: base.slice(0, 7), head: pr.headSha.slice(0, 7), files: [...ranges.keys()], analyzed: [...new Set(changed)] }));
      expect(new Set(changed)).toEqual(new Set(ranges.keys()));

      if (process.env.CALLPATH_LIVE_POST === "1") {
        const [path, list] = [...ranges].find(([, r]) => r.length > 0)!;
        const line = list[0]!.start;
        expect(canComment(ranges, path, line)).toBe(true);
        const posted = await provider.postLineComment(pr, { path, line, body: "[Callpath 게시 확인용 자동 코멘트입니다. 확인 직후 지웁니다.]" });
        console.log(JSON.stringify({ posted: posted.url, path, line }));
        await provider.deleteComment(pr, posted);
        // 지워졌는지 다시 읽어 확인한다
        const token = await ghCliToken(ref.host);
        const res = await fetch(`https://api.github.com/repos/${pr.repo}/pulls/comments/${posted.id}`, { headers: { authorization: `Bearer ${token}` } });
        console.log(JSON.stringify({ deleted: res.status === 404 }));
        expect(res.status).toBe(404);
      }
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
