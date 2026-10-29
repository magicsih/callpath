import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FileIndex, Language } from "@callpath/core";

const MARKER = ".callpath-complete";

/**
 * head 커밋의 파일을 캐시 폴더에 푼다. LSP는 디스크의 파일을 읽어야 하는데,
 * 사용자의 작업 트리를 체크아웃하거나 git worktree를 만들지 않도록 git archive로 내보낸다.
 */
export async function exportTree(repo: string, sha: string, dest: string): Promise<string> {
  if (existsSync(join(dest, MARKER))) return dest;
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = mkdtempSync(`${dest}-tmp-`);
  try {
    await new Promise<void>((resolve, reject) => {
      const archive = spawn("git", ["-C", repo, "archive", "--format=tar", sha], { stdio: ["ignore", "pipe", "pipe"] });
      const untar = spawn("tar", ["-x", "-C", tmp], { stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      archive.stderr.on("data", (d: Buffer) => (err += d.toString()));
      untar.stderr.on("data", (d: Buffer) => (err += d.toString()));
      archive.stdout.pipe(untar.stdin);
      archive.on("error", reject);
      untar.on("error", reject);
      untar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`head 코드를 내보내지 못했습니다: ${err.trim()}`))));
    });
    // 그사이 다른 실행이 같은 커밋을 끝냈으면 그것을 쓰고, 쓰는 중일 수 있는 폴더는 지우지 않는다
    if (existsSync(join(dest, MARKER))) {
      rmSync(tmp, { recursive: true, force: true });
      return dest;
    }
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true }); // 완료 표시가 없는 이전 실패 흔적
    renameSync(tmp, dest);
    writeFileSync(join(dest, MARKER), sha);
    return dest;
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

/**
 * 빌드 파일을 읽지 않고 패키지 선언으로 소스 루트를 추론한다.
 * src/main/java/shop/order/A.java의 패키지가 shop.order면 소스 루트는 src/main/java다.
 */
export function sourceRoots(files: Iterable<FileIndex>, language: Language): string[] {
  const roots = new Set<string>();
  for (const f of files) {
    if (f.language !== language) continue;
    const dir = dirname(f.path);
    const pkg = f.packageName.replace(/\./g, "/");
    if (!pkg) roots.add(dir === "." ? "." : dir);
    else if (dir === pkg) roots.add(".");
    else if (dir.endsWith(`/${pkg}`)) roots.add(dir.slice(0, -pkg.length - 1));
    else roots.add(dir);
  }
  return [...roots].sort();
}
