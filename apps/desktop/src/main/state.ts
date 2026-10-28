import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_STATE, type UiState } from "../shared/api";

const file = () => join(app.getPath("userData"), "state.json");

export async function loadState(): Promise<UiState> {
  try {
    const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<UiState>;
    return { recent: Array.isArray(raw.recent) ? raw.recent.slice(0, 10) : [], last: raw.last ?? null };
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveState(state: UiState): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  // 쓰다가 앱이 꺼져도 이전 상태가 깨지지 않게 임시 파일에 쓰고 바꿔 끼운다
  const tmp = `${file()}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, file());
}
