import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PullRequestInfo } from "./types.js";

const run = promisify(execFile);

/**
 * PR 코드를 앱 캐시의 bare 저장소로 받는다(설계 D14). 사용자 저장소에는 손대지 않는다.
 * 인증 헤더는 명령 인자가 아니라 GIT_CONFIG_* 환경 변수로만 넘겨 오류 문구와 프로세스 목록에 드러나지 않게 한다.
 */
export async function fetchPullRequestCode(cacheRoot: string, pr: PullRequestInfo, authHeader: string | null): Promise<string> {
  const dir = join(cacheRoot, pr.host, `${pr.repo}.git`);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (authHeader) Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: authHeader });
  const git = async (...args: string[]) => {
    try {
      return (await run("git", ["-C", dir, ...args], { env, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 })).stdout.trim();
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      const line = (err.stderr ?? err.message).split("\n").find((l) => /fatal|error/i.test(l)) ?? err.message.split("\n")[0];
      throw new Error(`코드를 받지 못했습니다: ${authHeader ? line!.split(authHeader).join("***") : line}`);
    }
  };
  if (!existsSync(join(dir, "HEAD"))) {
    mkdirSync(dir, { recursive: true });
    await run("git", ["init", "-q", "--bare", dir]);
  }
  // 원격 주소에는 자격 증명을 넣지 않는다
  const remotes = await git("remote");
  if (remotes.split("\n").includes("origin")) await git("remote", "set-url", "origin", pr.cloneUrl);
  else await git("remote", "add", "origin", pr.cloneUrl);
  // PR head는 반드시 받고, base 브랜치는 지워졌거나 이름이 바뀌었을 수 있어 따로 시도한다
  await git("fetch", "--no-tags", "--quiet", "origin", `+${pr.fetchRef}:refs/callpath/pr/${pr.number}`);
  await git("fetch", "--no-tags", "--quiet", "origin", `+refs/heads/${pr.baseRef}:refs/remotes/origin/${pr.baseRef}`).catch(() => undefined);
  const head = await git("rev-parse", `refs/callpath/pr/${pr.number}`);
  if (head !== pr.headSha) throw new Error(`받은 PR head(${head.slice(0, 7)})가 PR 정보(${pr.headSha.slice(0, 7)})와 다릅니다. PR에 새 커밋이 올라왔을 수 있으니 다시 여세요`);
  // base 커밋은 PR 정보의 SHA를 그대로 쓴다. 받은 base 브랜치 이력에 없으면 그 커밋만 따로 받는다
  const hasBase = await git("cat-file", "-t", pr.baseSha).then(() => true, () => false);
  if (!hasBase) await git("fetch", "--no-tags", "--quiet", "origin", pr.baseSha);
  return dir;
}
