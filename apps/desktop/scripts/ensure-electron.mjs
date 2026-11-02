// Electron 44는 설치 스크립트 없이, 처음 require("electron")을 부를 때 실행 파일을 GitHub에서 받는다.
// 그런데 electron-vite 6은 그 경로 파일(path.txt)을 직접 읽기 때문에, 새로 설치한 뒤 바로 dev를 띄우면
// "Electron uninstall"로 멈춘다. 그래서 dev를 띄우기 전에 한 번 불러 실행 파일을 받아 둔다.
// 설치(pnpm install) 때 받지 않는 것은, GitHub가 막힌 사내망에서 설치 자체가 오래 붙잡히지 않게 하려는 것이다
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let executable;
try {
  executable = require("electron");
} catch (e) {
  // Electron 원래 문구는 node_modules를 지우라고 하지만, 대개 원인은 네트워크다. 우리 안내를 먼저 보인다
  console.error("Electron 실행 파일을 GitHub에서 받지 못했습니다.");
  console.error("네트워크를 확인하세요. 사내망에서 GitHub가 막혀 있으면 ELECTRON_MIRROR로 미러를 지정한 뒤 다시 실행하면 이어서 받습니다.");
  console.error(`원래 오류: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

// app.setName은 OS가 표시하는 번들 이름을 바꾸지 않는다. 공용 Electron 원본은 보존하고
// 개발용 사본의 이름을 바꾼다. dev와 E2E가 같은 실행 파일을 사용한다.
if (process.platform === "darwin") {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = require("electron/package.json");
  const revision = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 12);
  const cache = join(appDir, "node_modules/.cache/callpath", `${version}-${process.arch}-${revision}`);
  const bundle = join(cache, "Callpath.app");
  const sourceBundle = resolve(executable, "../../..");
  executable = join(bundle, "Contents/MacOS/Electron");
  if (!existsSync(executable)) {
    mkdirSync(cache, { recursive: true });
    const staging = mkdtempSync(join(cache, "prepare-"));
    const copy = join(staging, "Callpath.app");
    try {
      cpSync(sourceBundle, copy, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
      const plist = join(copy, "Contents/Info.plist");
      for (const [key, value] of Object.entries({
        CFBundleDisplayName: "Callpath",
        CFBundleName: "Callpath",
        CFBundleIdentifier: "io.github.magicsih.callpath.dev",
      })) execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
      // Intel 배포본의 helper는 서명이 없을 수 있어 개발 사본 전체를 ad-hoc 서명한다.
      // 공개 배포 서명은 package-macos.mjs의 Developer ID 절차를 사용한다.
      execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", copy], { stdio: "pipe" });
      try {
        renameSync(copy, bundle);
      } catch (e) {
        // 동시에 dev와 E2E를 시작한 경우, 먼저 완성된 사본을 쓴다
        if (!existsSync(executable) || !["EEXIST", "ENOTEMPTY"].includes(e.code)) throw e;
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}

process.env.ELECTRON_EXEC_PATH = executable;
if (process.argv.includes("--print-path")) console.log(executable);
