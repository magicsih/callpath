import { app } from "electron";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { fetchPullRequestCode, parsePrUrl, parseRemote } from "@callpath/providers";
import type { PrList, PrMeta, PrProgress } from "../shared/api";
import { connectionForHostname, knownHosts, providerForHost } from "./connections";

const run = promisify(execFile);

export async function openPullRequest(url: string, progress: (p: PrProgress) => void): Promise<PrMeta> {
  const ref = parsePrUrl(url, knownHosts());
  if (!ref) {
    // 주소 모양은 PR인데 연결하지 않은 호스트면 연결 설정으로 안내한다
    let host = "";
    try {
      host = new URL(url.trim()).host;
    } catch {
      // 주소가 아님
    }
    const looksLikePr = host && (parsePrUrl(url, { github: [host], gitlab: [] }) ?? parsePrUrl(url, { github: [], gitlab: [host] }));
    if (looksLikePr) throw new NeedsConnection(host);
    throw new InvalidPrUrl();
  }
  const provider = providerForHost(ref.kind, ref.host);
  if (!provider) throw new NeedsConnection(ref.host);
  progress({ url, step: "info", message: "PR 정보를 받는 중" });
  const pr = await provider.fetchPullRequest(ref.repo, ref.number);
  progress({ url, step: "code", message: "코드를 받는 중. 저장소를 처음 받으면 오래 걸릴 수 있습니다" });
  const gitDir = await fetchPullRequestCode(join(app.getPath("userData"), "repos"), pr, await provider.gitAuthHeader());
  return {
    url: pr.url || url, kind: pr.kind, host: pr.host, repo: pr.repo, number: pr.number, title: pr.title, author: pr.author,
    baseRef: pr.baseRef, headRef: pr.headRef, baseSha: pr.baseSha, headSha: pr.headSha, ...(pr.startSha ? { startSha: pr.startSha } : {}), gitDir,
  };
}

export class InvalidPrUrl extends Error {
  constructor() {
    super("PR 주소를 읽지 못했습니다. GitHub는 …/pull/번호, GitLab은 …/-/merge_requests/번호 형식입니다");
  }
}

export class NeedsConnection extends Error {
  constructor(readonly host: string) {
    super(`${host}에 연결하지 않았습니다. 연결 설정에서 ${host}를 추가하세요`);
  }
}

/** 연결 설정의 호스트 칸에 넣을 값. http(s) 원격이면 포트까지, https가 아니면 scheme까지 둔다. ssh 원격은 호스트 이름만 안다 */
function webHostOf(remote: string, hostname: string): string {
  try {
    const u = new URL(remote.trim());
    if (u.protocol === "https:") return u.host;
    if (u.protocol === "http:") return `http://${u.host}`;
  } catch {
    // scp 형식(git@host:org/repo)
  }
  return hostname;
}

export async function listPullRequests(repoPath: string): Promise<PrList> {
  let remote: string;
  try {
    remote = (await run("git", ["-C", repoPath, "remote", "get-url", "origin"], { timeout: 10000 })).stdout.trim();
  } catch {
    return { status: "no-remote" };
  }
  const parsed = parseRemote(remote);
  if (!parsed) return { status: "no-remote" };
  const conn = connectionForHostname(parsed.host);
  if (!conn) {
    return { status: "needs-connection", host: parsed.host, webHost: webHostOf(remote, parsed.host), kind: parsed.host === "github.com" ? "github" : parsed.host === "gitlab.com" ? "gitlab" : null };
  }
  const prs = await conn.provider.listPullRequests(parsed.repo);
  return { status: "ok", host: conn.host, prs };
}
