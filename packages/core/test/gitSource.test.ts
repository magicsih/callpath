import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { analyze } from "../src/analyze.js";
import { GitRefSource } from "../src/source/fileSource.js";

const FIX = resolve(__dirname, "../../../fixtures/kotlin");

describe("GitRefSource", () => {
  it("git 저장소의 두 ref를 비교해도 디렉터리 비교와 같은 결과를 낸다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-review-git-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "pipe" });
    try {
      cpSync(join(FIX, "base"), dir, { recursive: true });
      git("init", "-q", "-b", "main");
      git("add", "-A");
      git("commit", "-qm", "base");
      rmSync(join(dir, "src"), { recursive: true });
      cpSync(join(FIX, "head"), dir, { recursive: true });
      git("add", "-A");
      git("commit", "-qm", "head");
      const base = new GitRefSource(dir, "HEAD~1");
      const head = new GitRefSource(dir, "HEAD");
      const session = await analyze(base, head, { repo: dir, baseLabel: await base.resolve(), headLabel: await head.resolve() });
      expect(session.base).toMatch(/^[0-9a-f]{40}$/);
      const step = session.orphans.find((s) => s.symbol.name === "placeOrder");
      expect(step?.callOrderDiff?.moved.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
