#!/usr/bin/env node
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { DirectorySource, GitRefSource, isDirectory } from "./source/fileSource.js";

const USAGE = `사용법:
  flow-review analyze <repo> --base <ref> --head <ref>     git 저장소의 두 ref 비교
  flow-review analyze --base-dir <dir> --head-dir <dir>   두 디렉터리 비교
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
  if (rest.includes("--summary")) {
    for (const s of session.orphans) {
      const flag = s.callOrderDiff?.moved.length ? "  ⚠ 순서 변경" : "";
      console.log(`${String(s.n).padStart(3)}  ${s.change.padEnd(9)} ${s.symbol.qualifiedName}${flag}`);
      if (s.callOrderDiff) {
        const names = (l: { name: string }[]) => l.map((c) => c.name).join(" → ");
        console.log(`       base: ${names(s.callOrderDiff.base)}`);
        console.log(`       head: ${names(s.callOrderDiff.head)}`);
      }
    }
    console.log(`\n메서드 밖 변경 ${session.outsideMethods.length}개, 테스트 ${session.otherTests.length}개, 비코드 ${session.nonCode.length}개`);
  } else {
    console.log(JSON.stringify(session, null, 2));
  }
  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
