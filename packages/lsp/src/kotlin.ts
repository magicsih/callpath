import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * 사용자가 설치한 kotlin-lsp를 찾는다(설계 D3: 앱은 내려받지 않는다).
 * CALLPATH_KOTLIN_LSP에 실행 파일 경로를 주거나, PATH의 kotlin-lsp를 쓴다. none이면 찾지 않는다.
 */
export async function findKotlinLsp(env: NodeJS.ProcessEnv = process.env): Promise<{ command: string; args: string[] } | { error: string }> {
  const hint = "kotlin-lsp를 설치하면(brew install JetBrains/utils/kotlin-lsp) Kotlin도 정밀 분석합니다";
  if (env.CALLPATH_KOTLIN_LSP === "none") return { error: `kotlin-lsp를 찾지 못했습니다. ${hint}` };
  if (env.CALLPATH_KOTLIN_LSP) {
    return existsSync(env.CALLPATH_KOTLIN_LSP)
      ? { command: env.CALLPATH_KOTLIN_LSP, args: ["--stdio"] }
      : { error: `CALLPATH_KOTLIN_LSP 경로에 실행 파일이 없습니다: ${env.CALLPATH_KOTLIN_LSP}` };
  }
  const which = process.platform === "win32" ? "where" : "which";
  for (const name of ["kotlin-lsp", "kotlin-lsp.sh"]) {
    try {
      const { stdout } = await run(which, [name], { timeout: 10000 });
      const path = stdout.split("\n")[0]?.trim();
      if (path) return { command: path, args: ["--stdio"] };
    } catch {
      // PATH에 없음
    }
  }
  return { error: `kotlin-lsp를 찾지 못했습니다. ${hint}` };
}
