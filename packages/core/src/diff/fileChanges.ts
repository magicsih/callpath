import { structuredPatch } from "diff";
import type { FileSource } from "../source/fileSource.js";
import type { FileChange, Hunk, Language, Range } from "../types.js";
import { isTestPath } from "../classify/test.js";

export function languageOf(path: string): Language | null {
  if (path.endsWith(".java")) return "java";
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
  const [baseFiles, headFiles] = await Promise.all([base.listFiles(), head.listFiles()]);
  const baseSet = new Set(baseFiles);
  const headSet = new Set(headFiles);
  const all = [...new Set([...baseFiles, ...headFiles])].sort();
  const out: ChangedFile[] = [];
  for (const path of all) {
    const baseText = baseSet.has(path) ? await base.read(path) : null;
    const headText = headSet.has(path) ? await head.read(path) : null;
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
