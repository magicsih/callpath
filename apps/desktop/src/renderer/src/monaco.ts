// 기본 메뉴(복사, 찾기 등)를 화면 언어에 맞춘다. 문구는 모듈을 읽는 순간 정해지므로 가장 먼저 불러온다
import "monaco-editor/nls/lang/ko";
import * as monaco from "monaco-editor/editor/editor.api";
// editor.api에는 기여 모듈이 없다. 언어 서비스 없이 읽기 전용 diff에 필요한 것만 불러온다
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/find/register";
import "monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution";
import "monaco-editor/editor/contrib/diffEditorBreadcrumbs/browser/contribution";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter";
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

export const EDITOR_OPTIONS = {
  readOnly: true,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderOverviewRuler: false,
  fontSize: 13,
  lineHeight: 20,
  wordWrap: "on",
  wrappingIndent: "indent",
} as const;

export function languageFor(path: string): string {
  if (path.endsWith(".java")) return "java";
  if (path.endsWith(".kt") || path.endsWith(".kts")) return "kotlin";
  if (path.endsWith(".xml")) return "xml";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}
