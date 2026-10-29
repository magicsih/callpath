import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type WebContents } from "electron";
import { ProviderError } from "@callpath/providers";
import { deleteConnection, listConnections, saveConnection } from "./connections";
import { InvalidPrUrl, listPullRequests, NeedsConnection, openPullRequest } from "./pullRequests";
import { addNote, deleteNote, listNotes, planPost, postNotes } from "./notes";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import workerPath from "./analyzeWorker?modulePath";
import { inspectRepo, PathError, readAt } from "./repo";
import { loadState, saveState } from "./state";
import type { AnalysisEvent, CompareRequest, ConnectionInput, ErrorKind, FileRequest, NoteScope, PostPlan, PrMeta, Result, UiState } from "../shared/api";
import type { WorkerEvent } from "./analyzeWorker";
import type { ReviewSession } from "@callpath/core";

// 테스트와 여러 프로필 실행을 위해 앱 데이터 폴더를 바꿀 수 있게 한다. ready 전에 정해야 한다
if (process.env.CALLPATH_USER_DATA) app.setPath("userData", process.env.CALLPATH_USER_DATA);
app.setName("Callpath");

function friendly(e: unknown): { error: string; kind: ErrorKind } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof PathError) return { error: msg, kind: "path" };
  if (e instanceof NeedsConnection) return { error: msg, kind: "connection" };
  if (e instanceof InvalidPrUrl) return { error: msg, kind: "input" };
  if (e instanceof ProviderError) return { error: msg, kind: e.code === "auth" ? "auth" : e.code === "network" ? "network" : "other" };
  if (/merge-base|unknown revision|bad revision|Not a valid object name|no merge base/i.test(msg)) {
    const ref = /Not a valid object name ([^\s]+)/.exec(msg)?.[1] ?? /bad revision '([^']+)'/.exec(msg)?.[1] ?? /unknown revision[^']*'([^']+)'/.exec(msg)?.[1];
    // merge-base는 공통 조상이 없으면 오류 문구 없이 종료 코드 1로 끝난다
    const what = ref
      ? `찾을 수 없는 이름: "${ref}".`
      : /merge-base/.test(msg) && !/fatal/i.test(msg)
        ? "두 시점에 공통 조상이 없습니다."
        : "비교할 브랜치나 커밋을 찾을 수 없습니다.";
    return { error: `${what} 비교를 다시 고르세요.`, kind: "ref" };
  }
  return { error: msg, kind: "other" };
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, ...friendly(e) };
  }
}

// ---------- 분석 워커 ----------

let worker: Worker | null = null;
let nextId = 1;
type WorkerReply = { ok: true; value: ReviewSession } | { ok: false; error: string };
const pending = new Map<number, (r: WorkerReply | Result<ReviewSession>) => void>();
/** 요청 번호별로, 정밀 분석 소식을 보낼 창과 요청 */
const listeners = new Map<number, { sender: WebContents; req: CompareRequest }>();

function forward(id: number, ev: AnalysisEvent): void {
  const l = listeners.get(id);
  if (l && !l.sender.isDestroyed()) l.sender.send("analysis-event", ev);
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerPath, { workerData: { userData: app.getPath("userData") } });
  w.on("message", (m: WorkerEvent) => {
    const l = listeners.get(m.id);
    if (m.kind === "fast") {
      pending.get(m.id)?.(m.ok ? { ok: true, value: m.value } : { ok: false, error: m.error });
      pending.delete(m.id);
      if (!m.ok) listeners.delete(m.id);
    } else if (l && m.kind === "status") {
      forward(m.id, { req: l.req, kind: "status", message: m.message });
    } else if (l && m.kind === "precise") {
      forward(m.id, m.ok ? { req: l.req, kind: "precise", session: m.value } : { req: l.req, kind: "precise-error", error: m.error });
      listeners.delete(m.id);
    }
  });
  const fail = (message: string) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: message, kind: "other" });
    pending.clear();
    // 빠른 분석은 끝났고 정밀 분석을 기다리던 화면도 멈추지 않게 알린다
    for (const [id, l] of listeners) forward(id, { req: l.req, kind: "precise-error", error: message });
    listeners.clear();
    if (worker === w) worker = null;
  };
  w.on("error", (err) => fail(`분석 중 오류: ${err.message}`));
  // 오류 이벤트 없이 끝나도(메모리 부족 등) 기다리던 요청이 멈추지 않게 한다
  w.on("exit", (code) => fail(`분석 작업이 멈췄습니다 (종료 코드 ${code}). 다시 분석하세요.`));
  worker = w;
  return w;
}

async function analyzeInWorker(req: CompareRequest, sender: WebContents): Promise<Result<ReviewSession>> {
  // 분석 중 화면을 검수하려고 일부러 늦출 때만 쓰는 값이다
  const delay = Number(process.env.CALLPATH_ANALYZE_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  const id = nextId++;
  listeners.set(id, { sender, req });
  return new Promise((resolve) => {
    pending.set(id, (r) => resolve(r.ok ? r : { ok: false, ...friendly(new Error(r.error)) }));
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
ipcMain.handle("analyze", (e, req: CompareRequest) => analyzeInWorker(req, e.sender));
ipcMain.handle("readFile", (_e, req: FileRequest) => wrap(() => readAt(req.repo, req.ref, req.path)));
ipcMain.handle("listConnections", () => listConnections());
ipcMain.handle("saveConnection", (_e, input: ConnectionInput) => wrap(() => saveConnection(input)));
ipcMain.handle("deleteConnection", (_e, id: string) => deleteConnection(id));
ipcMain.handle("openPullRequest", (e, url: string) => wrap(() => openPullRequest(url, (p) => !e.sender.isDestroyed() && e.sender.send("pr-progress", p))));
ipcMain.handle("listPullRequests", (_e, repoPath: string) => wrap(() => listPullRequests(repoPath)));
// 앱 밖 브라우저로는 웹 주소만 연다. 사내 GitHub Enterprise나 GitLab은 http로 쓰기도 한다
ipcMain.handle("openExternal", (_e, url: string) => {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
});
ipcMain.handle("listNotes", (_e, s: NoteScope) => listNotes(s));
ipcMain.handle("addNote", (_e, s: NoteScope, n: { path: string; line: number; body: string }) => wrap(async () => addNote(s, n)));
ipcMain.handle("deleteNote", (_e, id: number) => deleteNote(id));
ipcMain.handle("planPost", (_e, pr: PrMeta, ids: number[]) => wrap(() => planPost(pr, ids)));
ipcMain.handle("postNotes", (_e, pr: PrMeta, plans: PostPlan[]) => wrap(() => postNotes(pr, plans)));
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
