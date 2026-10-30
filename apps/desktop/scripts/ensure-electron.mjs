// Electron 44는 설치 스크립트 없이, 처음 require("electron")을 부를 때 실행 파일을 GitHub에서 받는다.
// 그런데 electron-vite 6은 그 경로 파일(path.txt)을 직접 읽기 때문에, 새로 설치한 뒤 바로 dev를 띄우면
// "Electron uninstall"로 멈춘다. 그래서 dev를 띄우기 전에 한 번 불러 실행 파일을 받아 둔다.
// 설치(pnpm install) 때 받지 않는 것은, GitHub가 막힌 사내망에서 설치 자체가 오래 붙잡히지 않게 하려는 것이다
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  require("electron");
} catch (e) {
  // Electron 원래 문구는 node_modules를 지우라고 하지만, 대개 원인은 네트워크다. 우리 안내를 먼저 보인다
  console.error("Electron 실행 파일을 GitHub에서 받지 못했습니다.");
  console.error("네트워크를 확인하세요. 사내망에서 GitHub가 막혀 있으면 ELECTRON_MIRROR로 미러를 지정한 뒤 다시 실행하면 이어서 받습니다.");
  console.error(`원래 오류: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
