import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const GOOD_TOKEN = "ghe-good-token-0123456789";
const FIX = resolve(__dirname, "../../../fixtures/java");

export interface Posted {
  kind: "line" | "general";
  body: string;
  path?: string;
  line?: number;
}

export interface MockGithub {
  url: string;
  posted: Posted[];
  /** PR 1의 주소 */
  prUrl: string;
  bare: string;
  close(): Promise<void>;
}

/** GitHub Enterprise(/api/v3)를 흉내 낸다. PR 1은 쿠폰 표본이고 클론 주소는 로컬 bare 저장소다 */
export async function startMockGithub(): Promise<MockGithub> {
  const dir = mkdtempSync(join(tmpdir(), "callpath-e2e-ghe-"));
  const work = join(dir, "work");
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  cpSync(join(FIX, "base"), work, { recursive: true });
  git(work, "add", "-A");
  git(work, "commit", "-qm", "base");
  const baseSha = git(work, "rev-parse", "HEAD");
  git(work, "checkout", "-q", "-b", "feature");
  rmSync(join(work, "src"), { recursive: true });
  cpSync(join(FIX, "head"), work, { recursive: true });
  git(work, "add", "-A");
  git(work, "commit", "-qm", "head");
  const headSha = git(work, "rev-parse", "HEAD");
  const bare = join(dir, "order.git");
  execFileSync("git", ["clone", "-q", "--bare", work, bare]);
  git(bare, "update-ref", "refs/pull/1/head", headSha);
  const files = git(work, "diff", "--name-only", baseSha, headSha).split("\n").filter(Boolean).map((filename) => {
    const full = git(work, "diff", "--unified=3", baseSha, headSha, "--", filename);
    return { filename, patch: full.slice(full.indexOf("@@")) };
  });

  const posted: Posted[] = [];
  let nextId = 500;
  const inDiff = (path: string, line: number) =>
    [...(files.find((f) => f.filename === path)?.patch ?? "").matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].some((m) => {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      return line >= start && line < start + count;
    });
  const readBody = (req: import("node:http").IncomingMessage) =>
    new Promise<Record<string, unknown>>((r) => {
      let s = "";
      req.on("data", (d) => (s += d));
      req.on("end", () => r(s ? JSON.parse(s) : {}));
    });
  let base = "";
  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url!, "http://x");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${GOOD_TOKEN}`) return json(401, { message: "Bad credentials" });
    const pull = {
      number: 1, title: "쿠폰 할인", html_url: `${base}/shop/order/pull/1`, updated_at: "2026-10-29T00:00:00Z", user: { login: "dev" },
      base: { ref: "main", sha: baseSha, repo: { clone_url: bare } }, head: { ref: "feature", sha: headSha },
    };
    const page = Number(u.searchParams.get("page") ?? 1);
    switch (`${req.method} ${u.pathname}`) {
      case "GET /api/v3/user":
        return json(200, { login: "reviewer" });
      case "GET /api/v3/repos/shop/order/pulls":
        return json(200, page > 1 ? [] : [pull]);
      case "GET /api/v3/repos/shop/order/pulls/1":
        return json(200, pull);
      case "GET /api/v3/repos/shop/order/pulls/1/files":
        return json(200, page > 1 ? [] : files);
      case "POST /api/v3/repos/shop/order/pulls/1/comments": {
        const b = await readBody(req);
        if (b.commit_id !== headSha || !inDiff(String(b.path), Number(b.line))) return json(422, { message: "Validation Failed: line must be part of the diff" });
        const id = nextId++;
        posted.push({ kind: "line", body: String(b.body), path: String(b.path), line: Number(b.line) });
        return json(201, { id, html_url: `${base}/shop/order/pull/1#discussion_r${id}` });
      }
      case "POST /api/v3/repos/shop/order/issues/1/comments": {
        const b = await readBody(req);
        const id = nextId++;
        posted.push({ kind: "general", body: String(b.body) });
        return json(201, { id, html_url: `${base}/shop/order/pull/1#issuecomment-${id}` });
      }
      default:
        return json(404, { message: "Not Found" });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    posted,
    prUrl: `${base}/shop/order/pull/1`,
    bare,
    close: () =>
      new Promise((r) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          r();
        });
        server.closeAllConnections();
      }),
  };
}
