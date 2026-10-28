import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { mapMethods } from "../src/analyze.js";
import { hunksBetween } from "../src/diff/fileChanges.js";

/** A2 속성 테스트: 무작위로 줄을 바꿔도 모든 hunk는 단계 또는 메서드 밖 변경에 정확히 보존된다. */
const BASE = `package p;

import java.util.List;

public class S {
    private int field = 1;

    public void a(int x) {
        one(x);
        two(x);
    }

    public int b() {
        return three();
    }

    void c() {
        four();
        five();
        six();
    }
}
`;

const mutations = fc.array(
  fc.record({
    line: fc.integer({ min: 0, max: BASE.split("\n").length - 2 }),
    op: fc.constantFrom("replace", "insert", "delete"),
    text: fc.constantFrom("        seven();", "    // note", "        eight(1, 2);", "    public void z() { nine(); }", ""),
  }),
  { minLength: 1, maxLength: 6 },
);

function mutate(text: string, ops: { line: number; op: string; text: string }[]): string {
  const lines = text.split("\n");
  for (const m of ops) {
    const i = Math.min(m.line, lines.length - 1);
    if (m.op === "replace") lines[i] = m.text;
    else if (m.op === "insert") lines.splice(i, 0, m.text);
    else lines.splice(i, 1);
  }
  return lines.join("\n");
}

describe("hunk 보존 속성", () => {
  it("모든 hunk는 steps 또는 leftover에 들어간다", async () => {
    await fc.assert(
      fc.asyncProperty(mutations, async (ops) => {
        const head = mutate(BASE, ops);
        const hunks = hunksBetween("S.java", BASE, head);
        const { steps, leftover } = await mapMethods({
          path: "S.java", status: "modified", language: "java", isTest: false, hunks, baseText: BASE, headText: head,
        });
        const seen = new Set<string>([...steps.flatMap((s) => s.hunks), ...leftover].map((h) => JSON.stringify(h)));
        for (const h of hunks) expect(seen.has(JSON.stringify(h))).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
