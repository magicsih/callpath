import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_STATE, type UiState } from "../shared/api";

const file = () => join(app.getPath("userData"), "state.json");

export async function loadState(): Promise<UiState> {
  try {
    const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<UiState>;
    return {
      recent: Array.isArray(raw.recent) ? raw.recent.slice(0, 10) : [],
      lastRepo: typeof raw.lastRepo === "string" ? raw.lastRepo : null,
      repos: raw.repos && typeof raw.repos === "object" ? raw.repos : {},
      prs: raw.prs && typeof raw.prs === "object" ? raw.prs : {},
      recentPrs: Array.isArray(raw.recentPrs) ? raw.recentPrs.slice(0, 10) : [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

let queue: Promise<void> = Promise.resolve();
let seq = 0;

/**
 * 단계를 빠르게 넘기면 저장 요청이 겹친다. 요청을 차례로 처리하고, 쓰다가 앱이 꺼져도
 * 이전 상태가 깨지지 않게 요청마다 다른 임시 파일에 쓴 뒤 바꿔 끼운다.
 */
export function saveState(state: UiState): Promise<void> {
  const body = JSON.stringify(state, null, 2);
  const tmp = `${file()}.${process.pid}.${++seq}.tmp`;
  const job = queue.then(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(tmp, body);
    await rename(tmp, file());
  });
  queue = job.catch(() => undefined);
  return job;
}
