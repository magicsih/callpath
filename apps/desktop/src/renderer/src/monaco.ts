import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/java/register";
import "monaco-editor/languages/definitions/kotlin/register";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";

// diff 계산은 편집기 워커가 한다. 외부 CDN 없이 앱 안의 워커 파일을 쓴다
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => monaco.editor.setTheme(dark.matches ? "vs-dark" : "vs");
applyTheme();
dark.addEventListener("change", applyTheme);

export { monaco };

export function languageFor(path: string): string {
  if (path.endsWith(".java")) return "java";
  if (path.endsWith(".kt") || path.endsWith(".kts")) return "kotlin";
  if (path.endsWith(".xml")) return "xml";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}
