import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** 고정한 JDT LS 배포판. 체크섬은 download.eclipse.org의 .sha256과 같다 */
export const JDTLS = {
  version: "1.61.0",
  file: "jdt-language-server-1.61.0-202609031315.tar.gz",
  sha256: "338e7e73d61836651ba2453919a0d34fa763eb4e7c03342092309bffb8934c64",
  url: "https://download.eclipse.org/jdtls/milestones/1.61.0/jdt-language-server-1.61.0-202609031315.tar.gz",
} as const;

const MARKER = ".callpath-complete";

function launcherIn(dir: string): string | null {
  const plugins = join(dir, "plugins");
  if (!existsSync(plugins)) return null;
  const jar = readdirSync(plugins).find((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f));
  return jar ? join(plugins, jar) : null;
}

/**
 * JDT LS를 준비한다. CALLPATH_JDTLS_DIR가 있으면 그 폴더를 쓰고, 없으면 cacheDir에 한 번 내려받아 체크섬을 확인한 뒤 푼다.
 */
export async function ensureJdtls(cacheDir: string, env: NodeJS.ProcessEnv = process.env, onProgress?: (msg: string) => void): Promise<string> {
  if (env.CALLPATH_JDTLS_DIR) {
    if (!launcherIn(env.CALLPATH_JDTLS_DIR)) throw new Error(`CALLPATH_JDTLS_DIR에 JDT LS가 없습니다: ${env.CALLPATH_JDTLS_DIR}`);
    return env.CALLPATH_JDTLS_DIR;
  }
  const dir = join(cacheDir, `jdtls-${JDTLS.version}`);
  if (existsSync(join(dir, MARKER)) && launcherIn(dir)) return dir;
  mkdirSync(cacheDir, { recursive: true });
  onProgress?.(`JDT LS ${JDTLS.version} 내려받는 중 (약 50MB)`);
  const res = await fetch(JDTLS.url);
  if (!res.ok) throw new Error(`JDT LS를 내려받지 못했습니다 (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== JDTLS.sha256) throw new Error("내려받은 JDT LS의 체크섬이 맞지 않습니다");
  const tmp = mkdtempSync(join(cacheDir, "jdtls-tmp-"));
  try {
    const archive = join(tmp, JDTLS.file);
    await writeFile(archive, buf);
    const out = join(tmp, "dist");
    mkdirSync(out);
    await run("tar", ["xzf", archive, "-C", out], { timeout: 120000 });
    if (existsSync(join(dir, MARKER)) && launcherIn(dir)) return dir; // 그사이 다른 실행이 준비를 끝냄
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); // 완료 표시가 없는 이전 실패 흔적
    renameSync(out, dir);
    writeFileSync(join(dir, MARKER), JDTLS.sha256);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return dir;
}

function configName(): string {
  const arm = process.arch === "arm64";
  if (process.platform === "darwin") return arm ? "config_mac_arm" : "config_mac";
  if (process.platform === "win32") return "config_win";
  return arm ? "config_linux_arm" : "config_linux";
}

/** JDT LS 실행 인자. 설정 폴더는 실행 중에 쓰이므로 작업 폴더로 복사해 쓴다 */
export function jdtlsCommand(jdtlsDir: string, javaBin: string, workDir: string): { command: string; args: string[] } {
  const launcher = launcherIn(jdtlsDir);
  if (!launcher) throw new Error("JDT LS 실행 파일을 찾지 못했습니다");
  const config = join(workDir, "config");
  if (!existsSync(config)) cpSync(join(jdtlsDir, configName()), config, { recursive: true });
  const data = join(workDir, "data");
  mkdirSync(data, { recursive: true });
  return {
    command: javaBin,
    args: [
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Dlog.level=WARNING",
      "-Xmx1G",
      "--add-modules=ALL-SYSTEM",
      "--add-opens", "java.base/java.util=ALL-UNNAMED",
      "--add-opens", "java.base/java.lang=ALL-UNNAMED",
      "-jar", launcher,
      "-configuration", config,
      "-data", data,
    ],
  };
}
