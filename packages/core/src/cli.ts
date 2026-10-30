#!/usr/bin/env node
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { analyze } from "./analyze.js";
import { ROLES } from "./config.js";
import { guide, type GuideResult } from "./guide/guide.js";
import { ROLE_LABEL } from "./names.js";
import { DirectorySource, GitRefSource, isDirectory, mergeBase, type FileSource } from "./source/fileSource.js";
import type { ReviewSession, Step } from "./types.js";

const MARK: Record<Step["change"], string> = { body: "본문", signature: "시그니처", renamed: "이름", added: "추가", removed: "삭제", unchanged: "진입점" };

function printStep(s: Step): void {
  const flags = [
    s.signatureChanged && s.change === "body" ? "시그니처도 바뀜" : "",
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

function printGuide(name: string, result: GuideResult, tourArg: string | undefined): void {
  const g = result.guide;
  const st = g.stats;
  console.log(`${name}  ${g.ref}${g.sha ? "@" + g.sha.slice(0, 7) : ""}${g.dir ? "  " + g.dir : ""}`);
  console.log(`파일 ${st.files}, 클래스 ${st.classes}, 메서드 ${st.methods}, 간선 ${st.edges}, 진입점 ${st.entries}, 생성 코드 제외 ${st.generated}, ${st.ms}ms\n`);
  const byId = new Map(g.classes.map((c) => [c.id, c]));
  for (const p of g.packages) {
    console.log(`▸ ${p.label}  파일 ${p.files}`);
    for (const role of ROLES) {
      const names = p.classIds.map((id) => byId.get(id)!).filter((c) => c.role === role).map((c) => c.name);
      if (names.length) console.log(`    ${ROLE_LABEL[role]}: ${names.join(", ")}`);
    }
  }
  const top = [...g.classes].filter((c) => c.fanIn > 0).sort((a, b) => b.fanIn - a.fanIn).slice(0, 10);
  if (top.length) console.log(`\n많이 쓰이는 클래스\n${top.map((c) => `    ${c.name} ${c.fanIn}`).join("\n")}`);
  console.log(`\n${g.noEntries ? "진입점이 없어 공개 API로 대신합니다" : "진입점"} ${g.entries.length}`);
  g.entries.forEach((e, i) => console.log(`  ${String(i + 1).padStart(3)} ${e.kind.padEnd(8)} ${e.label}`));
  if (!tourArg) return;
  const picks = tourArg === "all" ? g.entries : [g.entries[Number(tourArg) - 1]].filter((e) => e !== undefined);
  for (const e of picks) {
    const t = result.tour(e.id);
    console.log(`\n투어: ${e.label}  (단계 ${t.steps.length}, 접은 메서드 ${t.collapsed}${t.truncated ? ", 잘린 가지 있음" : ""})`);
    for (const s of t.steps) {
      const notes = [
        s.alternatives > 1 ? `갈래 ${s.alternatives}` : "",
        s.confidence === "low" ? "연결 불확실" : "",
        s.folded.length ? `접음: ${[...new Set(s.folded.map((f) => f.name))].join(", ")}` : "",
        ...s.calls.filter((c) => c.back).map((c) => `앞 단계 ${c.to}`),
      ].filter(Boolean).join(", ");
      console.log(`  ${String(s.n).padStart(3)} ${"  ".repeat(s.depth)}${s.symbol.qualifiedName}${notes ? "  (" + notes + ")" : ""}`);
    }
  }
}

async function runGuide(rest: string[]): Promise<number> {
  const target = rest.find((a, i) => !a.startsWith("--") && !["--ref", "--dir", "--tour"].includes(rest[i - 1] ?? ""));
  if (!target || !(await isDirectory(target))) { console.error(USAGE); return 2; }
  const root = resolve(target);
  const dir = arg("--dir", rest);
  const refArg = arg("--ref", rest);
  let source: FileSource;
  let ref = "작업 디렉터리";
  let sha = "";
  if (refArg || existsSync(join(root, ".git"))) {
    const git = new GitRefSource(root, refArg ?? "HEAD");
    source = git;
    ref = refArg ?? "HEAD";
    sha = await git.resolve();
  } else source = new DirectorySource(root);
  const result = await guide(source, { ref, sha, ...(dir ? { dir } : {}) });
  if (rest.includes("--summary")) printGuide(basename(root), result, arg("--tour", rest));
  else console.log(JSON.stringify(result.guide, null, 2));
  return 0;
}

const USAGE = `사용법:
  callpath analyze <repo> --base <ref> --head <ref>     git 저장소의 두 ref 비교
  callpath analyze --base-dir <dir> --head-dir <dir>   두 디렉터리 비교
  callpath guide <repo> [--ref HEAD] [--dir <경로>]     한 커밋의 저장소 지도와 진입점 (git이 아니면 디렉터리 그대로)
옵션:
  --json        JSON만 출력 (기본)
  --summary     사람이 읽는 요약 출력
  --tour <n|all>  guide 요약에 n번째 진입점(또는 전부)의 투어를 함께 출력`;

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "guide") return runGuide(argv.slice(1));
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
    const b = new GitRefSource(resolve(repo), await mergeBase(resolve(repo), base, head));
    const h = new GitRefSource(resolve(repo), head);
    session = await analyze(b, h, { repo: resolve(repo), baseLabel: await b.resolve(), headLabel: await h.resolve() });
  }
  if (rest.includes("--summary")) printSummary(session);
  else console.log(JSON.stringify(session, null, 2));
  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
