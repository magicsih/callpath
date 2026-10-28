import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { analyze, GitRefSource, mergeBase, type ReviewSession } from "@callpath/core";
import { createRefiner, findJava } from "../src/index.js";

/**
 * A8: JDK 21 이상과 JDT LS가 있으면 정밀 분석으로 간선이 high가 된다.
 * JDT LS는 CALLPATH_JDTLS_DIR나 CALLPATH_LSP_CACHE(한 번 내려받아 재사용)에서 찾는다. JDK가 없으면 건너뛴다.
 */
const java = await findJava();
const hasJava = !("error" in java);
const FIX = resolve(__dirname, "../../../fixtures");
const cache = process.env.CALLPATH_LSP_CACHE ?? join(tmpdir(), "callpath-lsp-cache");

function repoFrom(lang: "java" | "kotlin", editHead?: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "callpath-lsp-repo-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  cpSync(join(FIX, lang, "base"), dir, { recursive: true });
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-q", "-b", "feature");
  rmSync(join(dir, "src"), { recursive: true });
  cpSync(join(FIX, lang, "head"), dir, { recursive: true });
  editHead?.(dir);
  git("add", "-A");
  git("commit", "-qm", "head");
  return dir;
}

async function run(repo: string, precise: boolean): Promise<ReviewSession> {
  const baseSha = await mergeBase(repo, "main", "feature");
  const head = new GitRefSource(repo, "feature");
  const headSha = await head.resolve();
  const refine = precise ? createRefiner({ repo, headSha, cacheDir: cache }) : undefined;
  return analyze(new GitRefSource(repo, baseSha), head, { repo, baseLabel: baseSha, headLabel: headSha, ...(refine ? { refine } : {}) });
}

describe.skipIf(!hasJava)("JDT LS 정밀 분석 (A8)", () => {
  it("쿠폰 표본: 정밀 분석이 끝나고 흐름은 그대로, 바뀐 메서드 주변 간선은 high", async () => {
    const repo = repoFrom("java");
    try {
      const fast = await run(repo, false);
      const precise = await run(repo, true);
      expect(precise.analysis.precise).toBe("done");
      expect(precise.analysis.languages.java?.status).toBe("done");
      expect(precise.analysis.languages.java?.confirmedEdges).toBeGreaterThan(0);
      const names = (s: ReviewSession) => s.flows[0]!.steps.map((x) => x.symbol.name);
      expect(names(precise)).toEqual(names(fast));
      // placeOrder는 진입점에서 바로 불리고, 그 간선을 LSP가 확인했다
      const place = precise.flows[0]!.steps.find((x) => x.symbol.name === "placeOrder")!;
      expect(place.confidence).toBe("high");
      // placeOrder를 부르는 테스트 연결도 LSP가 확인했다
      expect(place.tests.every((t) => t.confidence === "high")).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("이름만으로 이으면 후보가 여럿이라 low였던 호출을 LSP가 하나로 확정한다", async () => {
    const repo = repoFrom("java", (dir) => {
      // 수신자 타입을 알 수 없는 호출(factory().approve)과 같은 이름, 인자 수의 메서드가 두 클래스에 있다
      const svc = join(dir, "src/main/java/shop/order/OrderService.java");
      writeFileSync(svc, readFileSync(svc, "utf8").replace("paymentClient.approve(discounted, request.couponCode());", "client().approve(discounted, request.couponCode());").replace("    public OrderResult placeOrder(", "    PaymentClient client() {\n        return paymentClient;\n    }\n\n    public OrderResult placeOrder("));
      writeFileSync(join(dir, "src/main/java/shop/order/RefundClient.java"), "package shop.order;\n\npublic class RefundClient {\n    public void approve(long amount, String reason) {\n    }\n}\n");
    });
    try {
      const fast = await run(repo, false);
      const precise = await run(repo, true);
      const approveIn = (s: ReviewSession) => s.flows[0]!.steps.filter((x) => x.symbol.name === "approve").map((x) => `${x.symbol.container}:${x.confidence}`);
      // 이름만으로는 두 클래스의 approve가 모두 후보라 둘 다 흐름에 들어가고 연결 불확실이다
      expect(approveIn(fast).sort()).toEqual(["PaymentClient:low", "RefundClient:low"]);
      // LSP는 실제 수신자 타입으로 PaymentClient 하나만 확정하고, RefundClient는 진입점 미확정으로 빠진다
      expect(approveIn(precise)).toEqual(["PaymentClient:high"]);
      expect(precise.orphans.map((x) => x.symbol.container)).toContain("RefundClient");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("정밀 분석 꺼짐과 도구 없음", () => {
  it("CALLPATH_PRECISE=off면 하지 않고 disabled로 알린다", async () => {
    const repo = repoFrom("java");
    try {
      const baseSha = await mergeBase(repo, "main", "feature");
      const head = new GitRefSource(repo, "feature");
      const headSha = await head.resolve();
      const s = await analyze(new GitRefSource(repo, baseSha), head, {
        repo, baseLabel: baseSha, headLabel: headSha,
        refine: createRefiner({ repo, headSha, cacheDir: cache, env: { CALLPATH_PRECISE: "off" } }),
      });
      expect(s.analysis.precise).toBe("skipped");
      expect(s.analysis.languages.java).toMatchObject({ status: "skipped", code: "disabled" });
      expect(s.flows[0]!.steps).toHaveLength(5);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("JDK가 없으면 Java는 no-tool로 건너뛰고, kotlin-lsp가 없으면 Kotlin도 건너뛴다", async () => {
    for (const lang of ["java", "kotlin"] as const) {
      const repo = repoFrom(lang);
      try {
        const baseSha = await mergeBase(repo, "main", "feature");
        const head = new GitRefSource(repo, "feature");
        const headSha = await head.resolve();
        const s = await analyze(new GitRefSource(repo, baseSha), head, {
          repo, baseLabel: baseSha, headLabel: headSha,
          refine: createRefiner({ repo, headSha, cacheDir: cache, env: { CALLPATH_JAVA_HOME: "none", CALLPATH_KOTLIN_LSP: "none" } }),
        });
        expect(s.analysis.languages[lang]).toMatchObject({ status: "skipped", code: "no-tool" });
        expect(s.flows[0]!.steps).toHaveLength(5);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    }
  });
});
