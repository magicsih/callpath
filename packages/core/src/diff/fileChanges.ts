import { structuredPatch } from "diff";
import type { FileSource } from "../source/fileSource.js";
import type { FileChange, Hunk, Language, Range } from "../types.js";
import { isTestPath } from "../classify/test.js";

export function languageOf(path: string): Language | null {
  if (path.endsWith(".java")) return "java";
  // build.gradle.kts, settings.gradle.kts 같은 빌드 스크립트는 리뷰에서 설정 변경이므로 코드로 분석하지 않는다
  if (path.endsWith(".gradle.kts")) return null;
  if (path.endsWith(".kt") || path.endsWith(".kts")) return "kotlin";
  return null;
}

/** 두 시점의 파일 내용을 비교해 hunk 범위를 만든다. 범위는 0부터 시작하는 줄 번호다. */
export function hunksBetween(path: string, baseText: string | null, headText: string | null): Hunk[] {
  if (baseText === null && headText === null) return [];
  if (baseText === null) return [{ path, base: null, head: wholeRange(headText!) }];
  if (headText === null) return [{ path, base: wholeRange(baseText), head: null }];
  const patch = structuredPatch(path, path, baseText, headText, "", "", { context: 0 });
  return patch.hunks.map((h) => ({
    path,
    base: h.oldLines === 0 ? null : { startLine: h.oldStart - 1, endLine: h.oldStart - 1 + h.oldLines - 1 },
    head: h.newLines === 0 ? null : { startLine: h.newStart - 1, endLine: h.newStart - 1 + h.newLines - 1 },
  }));
}

function wholeRange(text: string): Range | null {
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return lines === 0 ? null : { startLine: 0, endLine: lines - 1 };
}

export interface ChangedFile extends FileChange {
  baseText: string | null;
  headText: string | null;
}

export async function collectChanges(base: FileSource, head: FileSource): Promise<ChangedFile[]> {
  const [baseFiles, headFiles, baseIds, headIds] = await Promise.all([base.listFiles(), head.listFiles(), base.blobIds?.(), head.blobIds?.()]);
  const all = [...new Set([...baseFiles, ...headFiles])].sort();
  // 두 쪽 모두 내용 해시를 주면 해시로 바뀐 파일을 고르고, 아니면 내용을 읽어 비교한다
  const candidates = baseIds && headIds ? all.filter((p) => baseIds.get(p) !== headIds.get(p)) : all;
  const baseSet = new Set(baseFiles);
  const headSet = new Set(headFiles);
  const [baseTexts, headTexts] = await Promise.all([
    base.readMany(candidates.filter((p) => baseSet.has(p))),
    head.readMany(candidates.filter((p) => headSet.has(p))),
  ]);
  const out: ChangedFile[] = [];
  for (const path of candidates) {
    const baseText = baseTexts.get(path) ?? null;
    const headText = headTexts.get(path) ?? null;
    if (baseText === headText) continue;
    const hunks = hunksBetween(path, baseText, headText);
    if (hunks.length === 0) continue;
    out.push({
      path,
      status: baseText === null ? "added" : headText === null ? "removed" : "modified",
      language: languageOf(path),
      isTest: isTestPath(path),
      hunks,
      baseText,
      headText,
    });
  }
  return out;
}
