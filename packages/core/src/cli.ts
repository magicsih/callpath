#!/usr/bin/env node
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { DirectorySource, GitRefSource, isDirectory } from "./source/fileSource.js";
import type { ReviewSession, Step } from "./types.js";

const MARK: Record<Step["change"], string> = { body: "본문", signature: "시그니처", renamed: "이름", added: "추가", removed: "삭제", unchanged: "진입점" };

function printStep(s: Step): void {
  const flags = [
    s.callOrderDiff?.moved.length ? "⚠ 순서 변경" : "",
    s.confidence === "low" ? "연결 불확실" : "",
    s.refOf ? `${s.refOf.flow} ${s.refOf.n}단계 참조` : "",
    s.tests.length ? `테스트 ${s.tests.length}` : "",
  ].filter(Boolean).join(", ");
  console.log(`  ${String(s.n).padStart(2)}  ${MARK[s.change].padEnd(4)} ${s.symbol.qualifiedName}${flags ? "  (" + flags + ")" : ""}`);
  if (s.callOrderDiff?.moved.length) {
    const names = (l: { name: string }[]) => l.map((c) => c.name).join(" → ");
    console.log(`        base: ${names(s.callOrderDiff.base)}`);
    console.log(`        head: ${names(s.callOrderDiff.head)}`);
  }
}

function printSummary(session: ReviewSession): void {
  for (const f of session.flows) {
    console.log(`▸ ${f.label}${f.truncated ? "  (일부 가지 생략)" : ""}`);
    f.steps.forEach(printStep);
  }
  if (session.orphans.length) {
    console.log(`▸ 진입점 미확정 (${session.orphans.length})`);
    session.orphans.forEach(printStep);
  }
  const st = session.stats;
  console.log(`\n메서드 밖 변경 ${session.outsideMethods.length}개, 기타 테스트 ${session.otherTests.length}개, 비코드 ${session.nonCode.length}개`);
  console.log(`파일 ${st.files}, 메서드 ${st.methods}, 간선 ${st.edges}, 진입점 ${st.entries}, ${st.ms}ms`);
}

const USAGE = `사용법:
  callpath analyze <repo> --base <ref> --head <ref>     git 저장소의 두 ref 비교
  callpath analyze --base-dir <dir> --head-dir <dir>   두 디렉터리 비교
옵션:
  --json        JSON만 출력 (기본)
  --summary     사람이 읽는 요약 출력`;

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] !== "analyze") { console.error(USAGE); return 2; }
  const rest = argv.slice(1);
  const baseDir = arg("--base-dir", rest);
  const headDir = arg("--head-dir", rest);
  let session;
  if (baseDir && headDir) {
    if (!(await isDirectory(baseDir)) || !(await isDirectory(headDir))) { console.error("디렉터리를 찾을 수 없습니다"); return 2; }
    session = await analyze(new DirectorySource(resolve(baseDir)), new DirectorySource(resolve(headDir)), {
      repo: resolve(baseDir, ".."), baseLabel: resolve(baseDir), headLabel: resolve(headDir),
    });
  } else {
    const repo = rest.find((a) => !a.startsWith("--") && a !== arg("--base", rest) && a !== arg("--head", rest));
    const base = arg("--base", rest);
    const head = arg("--head", rest) ?? "HEAD";
    if (!repo || !base) { console.error(USAGE); return 2; }
    const b = new GitRefSource(resolve(repo), base);
    const h = new GitRefSource(resolve(repo), head);
    session = await analyze(b, h, { repo: resolve(repo), baseLabel: await b.resolve(), headLabel: await h.resolve() });
  }
  if (rest.includes("--summary")) printSummary(session);
  else console.log(JSON.stringify(session, null, 2));
  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
