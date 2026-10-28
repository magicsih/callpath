import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze } from "../src/analyze.js";
import { DirectorySource } from "../src/source/fileSource.js";
import type { CallpathConfig } from "../src/config.js";
import type { ReviewSession } from "../src/types.js";

export type Tree = Record<string, string>;

export function writeTree(root: string, files: Tree): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** base, head 두 파일 묶음을 임시 디렉터리에 쓰고 분석한다 */
export async function analyzeTrees(base: Tree, head: Tree, config?: CallpathConfig): Promise<ReviewSession> {
  const dir = mkdtempSync(join(tmpdir(), "callpath-"));
  try {
    // 한쪽이 빈 묶음이어도 디렉터리는 있어야 한다
    mkdirSync(join(dir, "base"), { recursive: true });
    mkdirSync(join(dir, "head"), { recursive: true });
    writeTree(join(dir, "base"), base);
    writeTree(join(dir, "head"), head);
    return await analyze(new DirectorySource(join(dir, "base")), new DirectorySource(join(dir, "head")), {
      repo: dir, baseLabel: "base", headLabel: "head", ...(config ? { config } : {}),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
