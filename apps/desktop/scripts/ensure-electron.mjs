// Electron 44는 설치 스크립트 없이, 처음 require("electron")을 부를 때 실행 파일을 GitHub에서 받는다.
// 그런데 electron-vite 6은 그 경로 파일(path.txt)을 직접 읽기 때문에, 새로 설치한 뒤 바로 dev를 띄우면
// "Electron uninstall"로 멈춘다. 그래서 설치 직후와 dev 전에 한 번 불러 실행 파일을 받아 둔다.
// --soft: 받지 못해도 설치를 막지 않고 알리기만 한다(오프라인 설치 등)
import { createRequire } from "node:module";

const soft = process.argv.includes("--soft");
const require = createRequire(import.meta.url);
try {
  const path = require("electron");
  if (!soft) console.log(`Electron 실행 파일: ${path}`);
} catch (e) {
  const log = soft ? console.warn : console.error;
  log(`Electron 실행 파일을 받지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  log("사내망에서 GitHub가 막혀 있으면 ELECTRON_MIRROR로 미러를 지정한 뒤 pnpm --filter @callpath/desktop run ensure-electron 을 실행하세요");
  process.exit(soft ? 0 : 1);
}
