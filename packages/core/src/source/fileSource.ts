import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 한 시점의 저장소 파일 집합. 디렉터리나 git ref로 만든다. */
export interface FileSource {
  readonly label: string;
  listFiles(): Promise<string[]>;
  read(path: string): Promise<string>;
  readMany(paths: string[]): Promise<Map<string, string>>;
  /** 경로 → 내용 해시. 제공하면 내용을 읽지 않고 바뀐 파일을 고른다 */
  blobIds?(): Promise<Map<string, string>>;
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

  async readMany(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const BATCH = 64;
    for (let i = 0; i < paths.length; i += BATCH) {
      const slice = paths.slice(i, i + BATCH);
      const texts = await Promise.all(slice.map((p) => this.read(p)));
      slice.forEach((p, j) => out.set(p, texts[j]!));
    }
    return out;
  }
}

export class GitRefSource implements FileSource {
  private treeCache: Promise<Map<string, string>> | null = null;

  constructor(private readonly repo: string, private readonly ref: string) {
    checkRef(ref);
  }

  get label(): string {
    return this.ref;
  }

  private tree(): Promise<Map<string, string>> {
    this.treeCache ??= (async () => {
      const { stdout } = await execFileAsync("git", ["-C", this.repo, "ls-tree", "-r", "-z", this.ref], { maxBuffer: 256 * 1024 * 1024 });
      const map = new Map<string, string>();
      for (const entry of stdout.split("\0")) {
        if (!entry) continue;
        const tab = entry.indexOf("\t");
        const [, type, hash] = entry.slice(0, tab).split(" ");
        if (type === "blob" && hash) map.set(entry.slice(tab + 1), hash);
      }
      return map;
    })();
    return this.treeCache;
  }

  async listFiles(): Promise<string[]> {
    return [...(await this.tree()).keys()].sort();
  }

  blobIds(): Promise<Map<string, string>> {
    return this.tree();
  }

  async read(path: string): Promise<string> {
    const text = (await this.readMany([path])).get(path);
    if (text === undefined) throw new Error(`${this.ref}:${path} 없음`);
    return text;
  }

  /** git cat-file --batch 한 번으로 여러 파일을 읽는다 */
  async readMany(paths: string[]): Promise<Map<string, string>> {
    const tree = await this.tree();
    const wanted = paths.filter((p) => tree.has(p));
    const out = new Map<string, string>();
    if (wanted.length === 0) return out;
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn("git", ["-C", this.repo, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let err = "";
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.stderr.on("data", (c: Buffer) => (err += c.toString()));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`git cat-file 실패 (${code}): ${err}`))));
      child.stdin.end(wanted.map((p) => tree.get(p)).join("\n") + "\n");
    });
    let pos = 0;
    for (const path of wanted) {
      const nl = buf.indexOf(0x0a, pos);
      const header = buf.subarray(pos, nl).toString();
      const size = Number(header.split(" ")[2]);
      if (!Number.isFinite(size)) throw new Error(`git cat-file 응답 해석 실패: ${header}`);
      out.set(path, buf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
      pos = nl + 1 + size + 1;
    }
    return out;
  }

  async resolve(): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", this.repo, "rev-parse", this.ref]);
    return stdout.trim();
  }
}

/**
 * PR 리뷰의 base는 두 ref의 merge-base다(설계 5.1의 git diff base...head).
 * base 브랜치가 앞서 나가도 그쪽 변경이 되돌림으로 섞이지 않는다.
 */
/** "-"로 시작하는 이름은 git이 옵션으로 읽으므로 받지 않는다. 오류 문구는 git의 bad revision과 같게 둔다 */
function checkRef(ref: string): void {
  if (ref.startsWith("-")) throw new Error(`bad revision '${ref}'`);
}

export async function mergeBase(repo: string, base: string, head: string): Promise<string> {
  checkRef(base);
  checkRef(head);
  const { stdout } = await execFileAsync("git", ["-C", repo, "merge-base", base, head]);
  return stdout.trim();
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
