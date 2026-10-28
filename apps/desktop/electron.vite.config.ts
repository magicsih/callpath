import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // 코어가 ESM 패키지라 main도 ESM으로 낸다
    build: { rollupOptions: { output: { format: "es" } } },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
