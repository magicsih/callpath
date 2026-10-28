/// <reference types="vite/client" />
import type { CallpathApi } from "../../shared/api";

declare global {
  interface Window {
    callpath: CallpathApi;
  }
}
