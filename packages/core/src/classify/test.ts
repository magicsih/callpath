/** 설계 5.6 테스트 분류. 1단계는 경로와 파일명 신호만 쓰고 애노테이션 신호는 2단계에서 더한다. */
const TEST_DIR = /(^|\/)(src\/test|src\/androidTest|src\/integrationTest|test|tests)\//;
const TEST_FILE = /(Test|Tests|Spec|IT)\.(java|kt)$/;

export function isTestPath(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILE.test(path);
}
