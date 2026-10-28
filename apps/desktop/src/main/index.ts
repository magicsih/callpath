import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import workerPath from "./analyzeWorker?modulePath";
import { inspectRepo, readAt } from "./repo";
import { loadState, saveState } from "./state";
import type { CompareRequest, FileRequest, Result, UiState } from "../shared/api";
import type { ReviewSession } from "@callpath/core";

// 테스트와 여러 프로필 실행을 위해 앱 데이터 폴더를 바꿀 수 있게 한다. ready 전에 정해야 한다
if (process.env.CALLPATH_USER_DATA) app.setPath("userData", process.env.CALLPATH_USER_DATA);
app.setName("Callpath");

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/merge-base|unknown revision|bad revision|Not a valid object name/i.test(msg)) return "비교할 브랜치나 커밋을 찾을 수 없습니다. 비교를 다시 고르세요.";
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

// ---------- 분석 워커 ----------

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: Result<ReviewSession>) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerPath);
  w.on("message", (m: { id: number } & Result<ReviewSession>) => {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  w.on("error", (err) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: `분석 중 오류: ${err.message}` });
    pending.clear();
    worker = null;
  });
  worker = w;
  return w;
}

async function analyzeInWorker(req: CompareRequest): Promise<Result<ReviewSession>> {
  // 분석 중 화면을 검수하려고 일부러 늦출 때만 쓰는 값이다
  const delay = Number(process.env.CALLPATH_ANALYZE_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, (r) => resolve(r.ok ? r : { ok: false, error: friendly(new Error(r.error)) }));
    getWorker().postMessage({ id, req });
  });
}

// ---------- IPC ----------

ipcMain.handle("pickFolder", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win!, { title: "리뷰할 저장소 폴더", properties: ["openDirectory"] });
  return r.canceled ? null : (r.filePaths[0] ?? null);
});
ipcMain.handle("inspectRepo", (_e, path: string) => wrap(() => inspectRepo(path)));
ipcMain.handle("analyze", (_e, req: CompareRequest) => analyzeInWorker(req));
ipcMain.handle("readFile", (_e, req: FileRequest) => wrap(() => readAt(req.repo, req.ref, req.path)));
ipcMain.handle("loadState", () => loadState());
ipcMain.handle("saveState", (_e, s: UiState) => saveState(s));

// ---------- 창 ----------

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Callpath",
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.js", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // 앱 밖으로 나가는 이동과 새 창을 막는다
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void worker?.terminate();
  if (process.platform !== "darwin") app.quit();
});
