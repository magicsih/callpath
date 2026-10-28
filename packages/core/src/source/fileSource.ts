import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 한 시점의 저장소 파일 집합. 디렉터리나 git ref로 만든다. */
export interface FileSource {
  readonly label: string;
  listFiles(): Promise<string[]>;
  read(path: string): Promise<string>;
}

const IGNORED_DIRS = new Set([".git", "node_modules", "build", "target", "out", ".gradle", ".idea"]);

export class DirectorySource implements FileSource {
  constructor(private readonly root: string, readonly label = root) {}

  async listFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) await walk(join(dir, entry.name));
        } else if (entry.isFile()) {
          out.push(relative(this.root, join(dir, entry.name)).split(sep).join("/"));
        }
      }
    };
    await walk(this.root);
    return out.sort();
  }

  async read(path: string): Promise<string> {
    return readFile(join(this.root, path), "utf8");
  }
}

export class GitRefSource implements FileSource {
  constructor(private readonly repo: string, private readonly ref: string) {}

  get label(): string {
    return this.ref;
  }

  async listFiles(): Promise<string[]> {
    const { stdout } = await execFileAsync("git", ["-C", this.repo, "ls-tree", "-r", "--name-only", "-z", this.ref], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split("\0").filter(Boolean).sort();
  }

  async read(path: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", this.repo, "show", `${this.ref}:${path}`], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  }

  async resolve(): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", this.repo, "rev-parse", this.ref]);
    return stdout.trim();
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
