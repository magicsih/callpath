import type { PullRequestRef } from "./types.js";

export interface KnownHosts {
  /** GitHub Enterprise 호스트 */
  github: string[];
  /** GitLab 호스트(gitlab.com 포함) */
  gitlab: string[];
}

/**
 * PR 주소를 읽는다. GitHub: https://<호스트>/<owner>/<repo>/pull/<n>,
 * GitLab: https://<호스트>/<그룹>/<프로젝트>/-/merge_requests/<iid>. 모르는 호스트면 null
 */
export function parsePrUrl(input: string, hosts: KnownHosts = { github: [], gitlab: [] }): PullRequestRef | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.host.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const isGitlab = host === "gitlab.com" || hosts.gitlab.map((h) => h.toLowerCase()).includes(host);
  const isGithub = host === "github.com" || hosts.github.map((h) => h.toLowerCase()).includes(host);
  if (isGitlab) {
    const dash = parts.indexOf("-");
    if (dash < 2 || parts[dash + 1] !== "merge_requests") return null;
    const n = Number(parts[dash + 2]);
    return Number.isInteger(n) && n > 0 ? { kind: "gitlab", host, repo: parts.slice(0, dash).join("/"), number: n } : null;
  }
  if (isGithub) {
    if (parts.length < 4 || parts[2] !== "pull") return null;
    const n = Number(parts[3]);
    return Number.isInteger(n) && n > 0 ? { kind: "github", host, repo: `${parts[0]}/${parts[1]}`, number: n } : null;
  }
  return null;
}

/** git 원격 주소(https, ssh)에서 호스트와 저장소 경로를 읽는다 */
export function parseRemote(remote: string): { host: string; repo: string } | null {
  // scp 형식(git@host:org/repo)에는 포트가 없다. 포트가 붙는 ssh://git@host:2222/org/repo는 아래 URL 해석으로 간다
  const ssh = /^git@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(remote.trim());
  if (ssh) return { host: ssh[1]!.toLowerCase(), repo: ssh[2]! };
  try {
    const u = new URL(remote.trim());
    const repo = u.pathname.replace(/^\/+/, "").replace(/\.git\/?$/, "");
    // 제공자 판별에는 포트를 뺀 호스트 이름을 쓴다
    return repo ? { host: u.hostname.toLowerCase(), repo } : null;
  } catch {
    return null;
  }
}
