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
  saveConnection: (input) => ipcRenderer.invoke("saveConnection", input),
  deleteConnection: (id) => ipcRenderer.invoke("deleteConnection", id),
  openPullRequest: (url) => ipcRenderer.invoke("openPullRequest", url),
  onPrProgress: (cb) => {
    const handler = (_e: unknown, p: PrProgress) => cb(p);
    ipcRenderer.on("pr-progress", handler);
    return () => ipcRenderer.removeListener("pr-progress", handler);
  },
  listPullRequests: (repoPath) => ipcRenderer.invoke("listPullRequests", repoPath),
  openExternal: (url) => ipcRenderer.invoke("openExternal", url),
  loadState: () => ipcRenderer.invoke("loadState"),
  saveState: (state) => ipcRenderer.invoke("saveState", state),
};

contextBridge.exposeInMainWorld("callpath", api);
