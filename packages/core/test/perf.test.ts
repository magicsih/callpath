import { describe, expect, it } from "vitest";
import { analyzeTrees, type Tree } from "./helpers.js";

/** A11: 변경 파일 50개, 바뀐 메서드 300개 규모의 빠른 분석 시간 */
function synthetic(version: "base" | "head"): Tree {
  const files: Tree = {};
  files["src/main/java/s/Api.java"] = `package s;\n\n@RestController\npublic class Api {\n    private final C0 c0;\n    @PostMapping("/run")\n    public void run() { c0.m0(); }\n}\n`;
  for (let f = 0; f < 50; f++) {
    const next = f < 49 ? `    private final C${f + 1} next;\n` : "";
    const methods = Array.from({ length: 6 }, (_, m) => {
      const call = m < 5 ? `        m${m + 1}();\n` : f < 49 ? "        next.m0();\n" : "";
      const changed = version === "head" ? `        log("v2-${f}-${m}");\n` : "";
      return `    public void m${m}() {\n${changed}        work(${m});\n${call}    }\n`;
    }).join("\n");
    files[`src/main/java/s/C${f}.java`] = `package s;\n\npublic class C${f} {\n${next}\n${methods}\n    void work(int x) {}\n    void log(String s) {}\n}\n`;
  }
  return files;
}

describe("성능", () => {
  it("A11: 50개 파일, 300개 바뀐 메서드", async () => {
    const session = await analyzeTrees(synthetic("base"), synthetic("head"));
    const steps = session.flows.flatMap((f) => f.steps).filter((s) => s.change !== "unchanged");
    console.log(`빠른 분석 ${session.stats.ms}ms, 흐름 단계 ${steps.length}, 미확정 ${session.orphans.length}, 잘림 ${session.flows.map((f) => f.truncated)}`);
    // 바뀐 메서드가 사슬로 이어지면 깊이 상한에 잘리지 않고 모두 한 흐름에 들어간다
    expect(steps.length).toBe(300);
    expect(session.orphans).toHaveLength(0);
    expect(session.flows[0]!.truncated).toBe(false);
    const appleSilicon = process.platform === "darwin" && process.arch === "arm64";
    expect(session.stats.ms).toBeLessThan(appleSilicon ? 3000 : 10000);
  });
});
