import type { FileIndex } from "../index/symbols.js";

/** 설계 5.6 테스트 분류: 경로, 파일명, 애노테이션과 상속 세 신호 중 하나면 테스트다. */
const TEST_DIR = /(^|\/)(src\/test|src\/androidTest|src\/integrationTest|src\/testFixtures|test|tests)\//;
const TEST_FILE = /(Test|Tests|Spec|IT)\.(java|kt)$/;
export const TEST_ANNOTATIONS = new Set(["Test", "ParameterizedTest", "RepeatedTest", "TestFactory", "TestTemplate", "Property"]);
const TEST_SUPERTYPES = new Set([
  "StringSpec", "FunSpec", "DescribeSpec", "BehaviorSpec", "ShouldSpec", "WordSpec",
  "FreeSpec", "FeatureSpec", "ExpectSpec", "AnnotationSpec", "TestCase",
]);

export function isTestPath(path: string): boolean {
  return TEST_DIR.test(path) || TEST_FILE.test(path);
}

export function isTestFile(index: FileIndex): boolean {
  if (isTestPath(index.path)) return true;
  if (index.classes.some((c) => c.supertypes.some((s) => TEST_SUPERTYPES.has(s)))) return true;
  return index.methods.some((m) => m.annotations.some((a) => TEST_ANNOTATIONS.has(a.name)));
}
