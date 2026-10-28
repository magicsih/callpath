import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface JavaRuntime {
  bin: string;
  major: number;
}

/** JDT LS 1.61은 Java 21 이상으로 실행된다(1.62부터는 플랫폼 번들이 Java 25를 요구한다) */
export const MIN_JAVA = 21;

async function versionOf(bin: string): Promise<number | null> {
  try {
    const { stderr, stdout } = await run(bin, ["-version"], { timeout: 15000 });
    const m = /version "(\d+)(?:\.(\d+))?/.exec(stderr + stdout);
    if (!m) return null;
    const major = Number(m[1]);
    return major === 1 ? Number(m[2]) : major;
  } catch {
    return null;
  }
}

/**
 * 정밀 분석에 쓸 JDK를 찾는다. 순서: CALLPATH_JAVA_HOME, JAVA_HOME, CI 러너의 JAVA_HOME_<버전>_*, macOS java_home, PATH의 java.
 * CALLPATH_JAVA_HOME=none이면 찾지 않는다.
 */
export async function findJava(env: NodeJS.ProcessEnv = process.env, min = MIN_JAVA): Promise<JavaRuntime | { error: string }> {
  if (env.CALLPATH_JAVA_HOME === "none") return { error: `JDK ${min} 이상을 찾지 못했습니다` };
  const homes: string[] = [];
  if (env.CALLPATH_JAVA_HOME) homes.push(env.CALLPATH_JAVA_HOME);
  if (env.JAVA_HOME) homes.push(env.JAVA_HOME);
  const runnerHomes = Object.entries(env)
    .map(([k, v]) => [/^JAVA_HOME_(\d+)_/.exec(k)?.[1], v] as const)
    .filter((x): x is readonly [string, string] => x[0] !== undefined && Number(x[0]) >= min && typeof x[1] === "string")
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map((x) => x[1]);
  homes.push(...runnerHomes);
  if (process.platform === "darwin") {
    try {
      const { stdout } = await run("/usr/libexec/java_home", ["-v", `${min}+`], { timeout: 15000 });
      if (stdout.trim()) homes.push(stdout.trim());
    } catch {
      // 맞는 JDK가 없으면 java_home이 실패한다
    }
  }
  const bins = [...new Set(homes.map((h) => join(h, "bin", process.platform === "win32" ? "java.exe" : "java")))].filter((b) => existsSync(b));
  bins.push("java");
  for (const bin of bins) {
    const major = await versionOf(bin);
    if (major !== null && major >= min) return { bin, major };
  }
  return { error: `JDK ${min} 이상을 찾지 못했습니다. JDK ${min} 이상을 설치하거나 JAVA_HOME을 지정하세요` };
}
