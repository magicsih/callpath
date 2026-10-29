import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { headRangesFromPatch } from "../src/index.js";

const FIX = resolve(__dirname, "../../../fixtures/java");
export const GOOD_TOKEN = "good-token-1234567890";

export interface Fixture {
  dir: string;
  bare: string;
  baseSha: string;
  headSha: string;
  /** 경로 → unified diff(헤더 뺀 hunk들) */
  patches: Map<string, string>;
  cleanup(): void;
}

/** 쿠폰 표본으로 main과 PR head가 있는 bare 저장소를 만든다 */
export function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "callpath-prov-"));
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
  const bare = join(dir, "remote.git");
  execFileSync("git", ["clone", "-q", "--bare", work, bare]);
  git(bare, "update-ref", "refs/pull/1/head", headSha);
  git(bare, "update-ref", "refs/merge-requests/1/head", headSha);
  git(bare, "update-ref", "-d", "refs/heads/feature");
  const patches = new Map<string, string>();
  for (const path of git(work, "diff", "--name-only", baseSha, headSha).split("\n").filter(Boolean)) {
    const full = git(work, "diff", "--unified=3", baseSha, headSha, "--", path);
    patches.set(path, full.slice(full.indexOf("@@")));
  }
  return { dir, bare, baseSha, headSha, patches, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

interface Posted {
  kind: "line" | "general";
  id: number;
  body: string;
  path?: string;
  line?: number;
}

export interface MockServer {
  url: string;
  posted: Posted[];
  close(): Promise<void>;
}

/** GitHub(/api/v3)과 GitLab(/api/v4)을 흉내 내는 서버 */
export async function startMock(fx: Fixture): Promise<MockServer> {
  const posted: Posted[] = [];
  let nextId = 100;
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((r) => {
      let s = "";
      req.on("data", (d) => (s += d));
      req.on("end", () => r(s ? JSON.parse(s) : {}));
    });
  const inDiff = (path: string, line: number) => headRangesFromPatch(fx.patches.get(path) ?? "").some((x) => line >= x.start && line <= x.end);
  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url!, "http://x");
    const p = u.pathname;
    const m = req.method!;
    const page = Number(u.searchParams.get("page") ?? 1);
    if (p.startsWith("/api/v3/")) {
      if (req.headers.authorization !== `Bearer ${GOOD_TOKEN}`) return json(res, 401, { message: "Bad credentials" });
      const r = p.slice("/api/v3".length);
      const pull = { number: 1, title: "쿠폰 할인", html_url: "https://ghe.test/shop/order/pull/1", updated_at: "2026-10-29T00:00:00Z", user: { login: "dev" }, base: { ref: "main", sha: fx.baseSha, repo: { clone_url: fx.bare } }, head: { ref: "feature", sha: fx.headSha } };
      if (m === "GET" && r === "/user") return json(res, 200, { login: "reviewer" });
      if (m === "GET" && r === "/repos/shop/order/pulls") return json(res, 200, [pull]);
      if (m === "GET" && r === "/repos/shop/order/pulls/1") return json(res, 200, pull);
      if (m === "GET" && r === "/repos/shop/order/pulls/1/files") return json(res, 200, page > 1 ? [] : [...fx.patches].map(([filename, patch]) => ({ filename, patch })));
      if (m === "POST" && r === "/repos/shop/order/pulls/1/comments") {
        const b = await readBody(req);
        if (b.commit_id !== fx.headSha || !inDiff(String(b.path), Number(b.line))) return json(res, 422, { message: "Validation Failed: line must be part of the diff" });
        const id = nextId++;
        posted.push({ kind: "line", id, body: String(b.body), path: String(b.path), line: Number(b.line) });
        return json(res, 201, { id, html_url: `https://ghe.test/shop/order/pull/1#discussion_r${id}` });
      }
      if (m === "POST" && r === "/repos/shop/order/issues/1/comments") {
        const b = await readBody(req);
        const id = nextId++;
        posted.push({ kind: "general", id, body: String(b.body) });
        return json(res, 201, { id, html_url: `https://ghe.test/shop/order/pull/1#issuecomment-${id}` });
      }
      const del = /^\/repos\/shop\/order\/(pulls|issues)\/comments\/(\d+)$/.exec(r);
      if (m === "DELETE" && del) {
        const i = posted.findIndex((x) => x.id === Number(del[2]));
        if (i < 0) return json(res, 404, { message: "Not Found" });
        posted.splice(i, 1);
        res.writeHead(204).end();
        return;
      }
      return json(res, 404, { message: "Not Found" });
    }
    if (p.startsWith("/api/v4/")) {
      if (req.headers["private-token"] !== GOOD_TOKEN) return json(res, 401, { message: "401 Unauthorized" });
      const r = p.slice("/api/v4".length);
      const proj = "/projects/" + encodeURIComponent("shop/backend/order");
      const mr = { iid: 1, title: "쿠폰 할인", web_url: "https://gitlab.test/shop/backend/order/-/merge_requests/1", updated_at: "2026-10-29T00:00:00Z", author: { username: "dev" }, source_branch: "feature", target_branch: "main", sha: fx.headSha, diff_refs: { base_sha: fx.baseSha, head_sha: fx.headSha, start_sha: fx.baseSha } };
      // 경로의 %2F는 Node가 그대로 두므로 원문과 비교한다
      const raw = req.url!.split("?")[0]!.slice("/api/v4".length);
      if (m === "GET" && r === "/user") return json(res, 200, { username: "reviewer" });
      if (m === "GET" && raw === `${proj}/merge_requests`) return json(res, 200, [mr]);
      if (m === "GET" && raw === `${proj}/merge_requests/1`) return json(res, 200, mr);
      if (m === "GET" && raw === proj) return json(res, 200, { http_url_to_repo: fx.bare });
      if (m === "GET" && raw === `${proj}/merge_requests/1/diffs`) return json(res, 200, page > 1 ? [] : [...fx.patches].map(([new_path, diff]) => ({ new_path, diff })));
      if (m === "POST" && raw === `${proj}/merge_requests/1/discussions`) {
        const b = (await readBody(req)) as { body: string; position: { new_path: string; new_line: number; head_sha: string } };
        if (b.position.head_sha !== fx.headSha || !inDiff(b.position.new_path, b.position.new_line)) return json(res, 400, { message: "400 Bad request - Note {:line_code=>[\"can't be blank\"]}" });
        const id = nextId++;
        posted.push({ kind: "line", id, body: b.body, path: b.position.new_path, line: b.position.new_line });
        return json(res, 201, { id: `d${id}`, notes: [{ id }] });
      }
      if (m === "POST" && raw === `${proj}/merge_requests/1/notes`) {
        const b = await readBody(req);
        const id = nextId++;
        posted.push({ kind: "general", id, body: String(b.body) });
        return json(res, 201, { id });
      }
      const del = new RegExp(`^${proj.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/merge_requests/1/notes/(\\d+)$`).exec(raw);
      if (m === "DELETE" && del) {
        const i = posted.findIndex((x) => x.id === Number(del[1]));
        if (i < 0) return json(res, 404, { message: "404 Not found" });
        posted.splice(i, 1);
        res.writeHead(204).end();
        return;
      }
      return json(res, 404, { message: "404 Not found" });
    }
    json(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, posted, close: () => new Promise((r) => server.close(() => r())) };
}
