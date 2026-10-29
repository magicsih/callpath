import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";

// 분석 워커는 코어와 LSP 패키지 빌드 결과의 해시를 세션 캐시 키에 넣는다(src/main/analyzeWorker.ts).
// 패키지 위치를 못 찾으면 시각을 대신 써서 캐시가 다음 실행에서 한 번도 맞지 않는다. 그래서 워커와 같은 방식으로 찾아진다는 것을 지킨다
describe("분석 워커가 쓰는 패키지 찾기", () => {
  it("require 방식으로 @callpath/core와 @callpath/lsp를 찾는다", () => {
    const require = createRequire(join(__dirname, "../src/main/analyzeWorker.ts"));
    for (const pkg of ["@callpath/core", "@callpath/lsp"]) expect(() => require.resolve(pkg)).not.toThrow();
  });
});
