import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const [output, arch = "universal"] = process.argv.slice(2);
if (process.platform !== "darwin" || !output || !["arm64", "x64", "universal"].includes(arch)) {
  throw new Error("Usage (macOS): pnpm package:macos <new-output-directory> [universal|arm64|x64]");
}
if (run("git", ["status", "--porcelain"])) throw new Error("Commit the candidate before packaging");
const sourceSHA = run("git", ["rev-parse", "HEAD"]);
const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const out = resolve(output);
mkdirSync(dirname(out), { recursive: true });
mkdirSync(out, { recursive: false }); // 기존 배포물을 덮어쓰지 않는다
const stage = mkdtempSync(join(tmpdir(), "callpath-package-"));
const identity = process.env.CALLPATH_SIGN_IDENTITY;
if (identity) {
  const runId = process.env.CALLPATH_CI_RUN;
  if (!runId) throw new Error("Signed packaging requires CALLPATH_CI_RUN");
  const ci = JSON.parse(run("gh", ["run", "view", runId, "--repo", "magicsih/callpath", "--json", "headSha,conclusion,status,url,workflowName,updatedAt"]));
  if (ci.headSha !== sourceSHA || ci.status !== "completed" || ci.conclusion !== "success" || ci.workflowName !== "CI") {
    throw new Error("The complete CI must pass on the exact release candidate");
  }
  const age = Date.now() - Date.parse(ci.updatedAt);
  if (!(age >= 0 && age <= 168 * 60 * 60 * 1000)) throw new Error("Release CI evidence is stale");
  writeFileSync(join(out, "ci.json"), JSON.stringify(ci, null, 2) + "\n");
}
try {
  execFileSync("pnpm", ["--filter", "@callpath/desktop", "--prod", "deploy", "--ignore-scripts", join(stage, "app")], { cwd: root, stdio: "inherit" });
  const stagedRequire = createRequire(join(stage, "app/package.json"));
  const coreRequire = createRequire(stagedRequire.resolve("@callpath/core"));
  // 분석기는 WASM 문법만 쓴다. 사용하지 않는 플랫폼별 Node 확장은 universal 병합에서 제외한다.
  for (const wasm of ["tree-sitter-java/tree-sitter-java.wasm", "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm"]) {
    rmSync(join(dirname(coreRequire.resolve(wasm)), "prebuilds"), { recursive: true, force: true });
  }
  const [built] = await packager({
    dir: join(stage, "app"), out: join(stage, "packaged"), name: "Callpath",
    platform: "darwin", arch, electronVersion: pkg.devDependencies.electron,
    appBundleId: "io.github.magicsih.callpath", appVersion: pkg.version, buildVersion: pkg.version,
    asar: false, prune: false,
    // 배포된 production 의존성만 복사한다. WASM과 worker의 파일 경로를 보존한다.
    osxSign: identity ? {
      identity, continueOnError: false, preAutoEntitlements: false,
      optionsForFile: () => ({ hardenedRuntime: true, entitlements: ["com.apple.security.cs.allow-jit"] }),
    } : undefined,
  });
  const app = join(out, "Callpath.app");
  renameSync(join(built, "Callpath.app"), app);
  const executable = join(app, "Contents/MacOS/Callpath");
  const architectures = run("/usr/bin/lipo", ["-archs", executable]).split(/\s+/).sort();
  const expected = (arch === "universal" ? ["arm64", "x86_64"] : [arch === "x64" ? "x86_64" : arch]).sort();
  if (JSON.stringify(architectures) !== JSON.stringify(expected)) throw new Error("Unexpected Mach-O architectures");
  if (identity) execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  const info = {
    sourceSHA, version: pkg.version, bundleId: "io.github.magicsih.callpath", architectures,
    minimumOS: run("/usr/libexec/PlistBuddy", ["-c", "Print :LSMinimumSystemVersion", join(app, "Contents/Info.plist")]),
    electronVersion: pkg.devDependencies.electron, signed: Boolean(identity),
    binarySHA256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
  };
  writeFileSync(join(out, "package-info.json"), JSON.stringify(info, null, 2) + "\n");
  console.log(`Packaged ${app} (${architectures.join(", ")}, ${identity ? "signed" : "unsigned"})`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
