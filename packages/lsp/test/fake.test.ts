import { describe, expect, it } from "vitest";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { analyze, DirectorySource, overall } from "@callpath/core";
import { createRefiner, LspClient } from "../src/index.js";

const FAKE = resolve(__dirname, "fake-lsp.mjs");
const FIX = resolve(__dirname, "../../../fixtures/kotlin");

function fakeServer(dir: string, readyMs?: number, env: Record<string, string> = {}): { bin: string; log: string } {
  const bin = join(dir, "fake-kotlin-lsp");
  const log = join(dir, "fake.log");
  const vars = { ...(readyMs !== undefined ? { FAKE_LSP_READY_MS: String(readyMs) } : {}), ...env };
  const prefix = Object.entries(vars).map(([k, v]) => `${k}=${v} `).join("");
  writeFileSync(bin, `#!/bin/sh\n${prefix}FAKE_LSP_LOG="${log}" exec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(bin, 0o755);
  return { bin, log };
}

const lines = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

describe("정밀 분석 상태 모으기", () => {
  it("한 언어라도 끝나면 done, 모두 실패면 failed, 나머지는 skipped", () => {
    expect(overall({ java: { status: "done" }, kotlin: { status: "failed", code: "error" } })).toBe("done");
    expect(overall({ java: { status: "failed" }, kotlin: { status: "skipped" } })).toBe("failed");
    expect(overall({ kotlin: { status: "skipped", code: "no-tool" } })).toBe("skipped");
    expect(overall({})).toBe("skipped");
  });
});

describe("가짜 LSP 서버", () => {
  it("workspace/configuration에는 요청한 섹션의 값만 돌려준다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "callpath-fake-"));
    try {
      const { bin, log } = fakeServer(dir);
      const client = await LspClient.start({ name: "fake", command: bin, args: [], cwd: dir, rootDir: dir, settings: { java: { project: { sourcePaths: ["src"] } } } });
      for (let i = 0; i < 50 && !lines(log).some((l) => l.configurationResponse); i++) await new Promise((r) => setTimeout(r, 100));
      await client.stop();
      const res = lines(log).find((l) => l.configurationResponse)!.configurationResponse;
      expect(res).toEqual([{ sourcePaths: ["src"] }, { java: { project: { sourcePaths: ["src"] } } }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("시간이 지나면 timeout으로 끝내고 서버를 끄며 흐름은 빠른 분석 그대로다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "callpath-fake-"));
    try {
      const { bin, log } = fakeServer(dir);
      // DirectorySource로는 head 커밋을 내보낼 수 없어 표본 head를 미리 푼 것처럼 캐시 폴더에 둔다
      const tree = join(dir, "cache", "trees", "fakehead");
      const { cpSync } = await import("node:fs");
      cpSync(join(FIX, "head"), tree, { recursive: true });
      writeFileSync(join(tree, ".callpath-complete"), "fakehead");
      const started = Date.now();
      const s = await analyze(new DirectorySource(join(FIX, "base")), new DirectorySource(join(FIX, "head")), {
        repo: dir, baseLabel: "base", headLabel: "head",
        refine: createRefiner({ repo: dir, headSha: "fakehead", cacheDir: join(dir, "cache"), timeoutMs: 3000, env: { CALLPATH_KOTLIN_LSP: bin } }),
      });
      expect(Date.now() - started).toBeLessThan(20000);
      expect(s.analysis.languages.kotlin).toMatchObject({ status: "failed", code: "timeout" });
      expect(s.flows[0]!.steps).toHaveLength(5);
      const pid = lines(log).find((l) => l.started)!.started as number;
      await new Promise((r) => setTimeout(r, 1500));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** DirectorySource로는 head 커밋을 내보낼 수 없어 표본 head를 미리 푼 것처럼 캐시 폴더에 둔다 */
function seedTree(dir: string) {
  const tree = join(dir, "cache", "trees", "fakehead");
  cpSync(join(FIX, "head"), tree, { recursive: true });
  writeFileSync(join(tree, ".callpath-complete"), "fakehead");
}

describe("시작과 빈 결과", () => {
  it("initialize에 답하지 않으면 시간 안에 실패하고 서버 프로세스를 끈다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "callpath-fake-"));
    try {
      const { bin, log } = fakeServer(dir, undefined, { FAKE_LSP_NO_INIT: "1" });
      // 제한은 모의 서버가 떠서 기록을 남길 만큼 넉넉히 둔다
      await expect(LspClient.start({ name: "fake", command: bin, args: [], cwd: dir, rootDir: dir, settings: {}, initTimeoutMs: 3000 })).rejects.toThrow("fake 시작 시간 초과");
      const pid = lines(log).find((l) => l.started)!.started as number;
      await new Promise((r) => setTimeout(r, 1000));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("준비 신호가 없는 서버(kotlin-lsp)가 빈 결과만 주면 1계층 간선을 지우지 않는다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "callpath-fake-"));
    try {
      const { bin } = fakeServer(dir, undefined, { FAKE_LSP_EMPTY: "1" });
      seedTree(dir);
      const s = await analyze(new DirectorySource(join(FIX, "base")), new DirectorySource(join(FIX, "head")), {
        repo: dir, baseLabel: "base", headLabel: "head",
        refine: createRefiner({ repo: dir, headSha: "fakehead", cacheDir: join(dir, "cache"), timeoutMs: 30000, env: { CALLPATH_KOTLIN_LSP: bin } }),
      });
      expect(s.analysis.languages.kotlin).toMatchObject({ status: "done", confirmedEdges: 0 });
      expect(s.flows[0]!.steps).toHaveLength(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("준비 신호", () => {
  it("ServiceReady가 올 때까지 기다리고, 오지 않으면 시간 안에 false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "callpath-fake-"));
    try {
      const late = fakeServer(dir, 800);
      const a = await LspClient.start({ name: "fake", command: late.bin, args: [], cwd: dir, rootDir: dir, settings: {} });
      const t0 = Date.now();
      expect(await a.waitForServiceReady(5000)).toBe(true);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
      await a.stop();
      const never = fakeServer(join(dir), undefined);
      const b = await LspClient.start({ name: "fake", command: never.bin, args: [], cwd: dir, rootDir: dir, settings: {} });
      expect(await b.waitForServiceReady(500)).toBe(false);
      await b.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
