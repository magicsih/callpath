import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * 로그인된 gh CLI의 토큰을 읽는다(설계 D13). 토큰은 돌려주기만 하고 어디에도 쓰지 않는다.
 * gh가 없거나 그 호스트에 로그인하지 않았으면 null
 */
export async function ghCliToken(host = "github.com"): Promise<string | null> {
  try {
    const { stdout } = await run("gh", ["auth", "token", "--hostname", host], { timeout: 15000 });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

export async function ghCliAvailable(host = "github.com"): Promise<boolean> {
  return (await ghCliToken(host)) !== null;
}
