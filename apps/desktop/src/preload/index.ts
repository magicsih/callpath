import { contextBridge, ipcRenderer } from "electron";
import type { AnalysisEvent, CallpathApi, PrProgress } from "../shared/api";

const api: CallpathApi = {
  pickFolder: () => ipcRenderer.invoke("pickFolder"),
  inspectRepo: (path) => ipcRenderer.invoke("inspectRepo", path),
  analyze: (req) => ipcRenderer.invoke("analyze", req),
  readFile: (req) => ipcRenderer.invoke("readFile", req),
  onAnalysisEvent: (cb) => {
    const handler = (_e: unknown, ev: AnalysisEvent) => cb(ev);
    ipcRenderer.on("analysis-event", handler);
    return () => ipcRenderer.removeListener("analysis-event", handler);
  },
  listConnections: () => ipcRenderer.invoke("listConnections"),
  saveConnection: (input, requestId) => ipcRenderer.invoke("saveConnection", input, requestId),
  cancelConnectionCheck: (requestId) => ipcRenderer.invoke("cancelConnectionCheck", requestId),
  deleteConnection: (id) => ipcRenderer.invoke("deleteConnection", id),
  openPullRequest: (url) => ipcRenderer.invoke("openPullRequest", url),
  onPrProgress: (cb) => {
    const handler = (_e: unknown, p: PrProgress) => cb(p);
    ipcRenderer.on("pr-progress", handler);
    return () => ipcRenderer.removeListener("pr-progress", handler);
  },
  listPullRequests: (repoPath) => ipcRenderer.invoke("listPullRequests", repoPath),
  openExternal: (url) => ipcRenderer.invoke("openExternal", url),
  getLlmSettings: () => ipcRenderer.invoke("getLlmSettings"),
  saveLlmSettings: (input, requestId) => ipcRenderer.invoke("saveLlmSettings", input, requestId),
  cancelLlmCheck: (requestId) => ipcRenderer.invoke("cancelLlmCheck", requestId),
  previewExplain: (req) => ipcRenderer.invoke("previewExplain", req),
  sendExplain: (id) => ipcRenderer.invoke("sendExplain", id),
  cancelExplain: (id) => ipcRenderer.invoke("cancelExplain", id),
  discardExplain: (id) => ipcRenderer.invoke("discardExplain", id),
  onLlmEvent: (cb) => {
    const h = (_e: unknown, ev: Parameters<typeof cb>[0]) => cb(ev);
    ipcRenderer.on("llm-event", h);
    return () => ipcRenderer.removeListener("llm-event", h);
  },
  showLlmLog: () => ipcRenderer.invoke("showLlmLog"),
  checkKeyFile: (k) => ipcRenderer.invoke("checkKeyFile", k),
  listNotes: (scope) => ipcRenderer.invoke("listNotes", scope),
  addNote: (scope, note) => ipcRenderer.invoke("addNote", scope, note),
  deleteNote: (id) => ipcRenderer.invoke("deleteNote", id),
  planPost: (pr, ids) => ipcRenderer.invoke("planPost", pr, ids),
  postNotes: (pr, plans) => ipcRenderer.invoke("postNotes", pr, plans),
  loadState: () => ipcRenderer.invoke("loadState"),
  saveState: (state) => ipcRenderer.invoke("saveState", state),
};

contextBridge.exposeInMainWorld("callpath", api);
