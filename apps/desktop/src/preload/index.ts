import { contextBridge, ipcRenderer } from "electron";
import type { AnalysisEvent, CallpathApi } from "../shared/api";

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
  loadState: () => ipcRenderer.invoke("loadState"),
  saveState: (state) => ipcRenderer.invoke("saveState", state),
};

contextBridge.exposeInMainWorld("callpath", api);
