import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { GitRefSource } from "@callpath/core";
import type { RepoInfo } from "../shared/api";

const run = promisify(execFile);

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

async function tryGit(repo: string, ...args: string[]): Promise<string | null> {
  try {
    return await git(repo, ...args);
  } catch {
    return null;
  }
}

export class PathError extends Error {}

export async function inspectRepo(path: string): Promise<RepoInfo> {
  const info = await stat(path).catch(() => null);
  if (!info) throw new PathError("폴더를 찾을 수 없습니다. 경로를 확인하세요.");
  if (!info.isDirectory()) throw new PathError("파일이 아니라 저장소 폴더를 고르세요.");
  const top = await tryGit(path, "rev-parse", "--show-toplevel");
  if (!top) throw new PathError("Git 저장소가 아닙니다. 저장소의 최상위 폴더나 그 안의 폴더를 고르세요.");
  const refs = (await git(top, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"))
    .split("\n")
    .filter((r) => r && !r.endsWith("/HEAD") && r !== "origin");
  const originHead = await tryGit(top, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  const defaultBase = originHead ?? ["main", "master", "develop"].find((b) => refs.includes(b)) ?? null;
  let current = await tryGit(top, "rev-parse", "--abbrev-ref", "HEAD");
  if (current === "HEAD") current = await tryGit(top, "rev-parse", "--short", "HEAD");
  return { path: top, name: basename(top), branches: refs, defaultBase, current };
}

/** 커밋별 파일 읽기. 같은 커밋의 트리 목록은 한 번만 읽는다 */
const sources = new Map<string, GitRefSource>();

export async function readAt(repo: string, ref: string, path: string): Promise<string | null> {
  const key = `${repo}\0${ref}`;
  let src = sources.get(key);
  if (!src) {
    src = new GitRefSource(repo, ref);
    sources.set(key, src);
  }
  return (await src.readMany([path])).get(path) ?? null;
}
