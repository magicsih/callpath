import { createContext, useContext, useEffect, type RefObject } from "react";
import type { GuideTarget } from "../../shared/api";
import { monaco } from "./monaco";

export type NavigationDocument = { path: string; source: "base" | "head" | "code" };
export type NavigationScope = GuideTarget & { source: NavigationDocument["source"]; label: string };
export type EditorBinding = NavigationDocument & { target: NavigationScope; firstLine: number; editor: monaco.editor.IStandaloneCodeEditor };
export interface CodeNavigationController {
  target(source: NavigationDocument["source"]): NavigationScope | undefined;
  register(binding: EditorBinding): () => void;
  search(): void;
  followClass(path: string, qualifiedName: string): void;
  covered: boolean;
  canForward: boolean;
  forward(): void;
}
export const CodeNavigationContext = createContext<CodeNavigationController | null>(null);
export const useCodeNavigation = () => useContext(CodeNavigationContext);

export function useNavigationUri(document: NavigationDocument | undefined, firstLine: number, view: string): monaco.Uri | undefined {
  const nav = useCodeNavigation(), target = document && nav?.target(document.source);
  return target && document ? monaco.Uri.from({ scheme: "callpath", authority: target.sha, path: "/" + document.path, query: new URLSearchParams({ repo: target.repo, from: String(firstLine), view }).toString() }) : undefined;
}

export function useNavigationEditor(editor: RefObject<monaco.editor.IStandaloneCodeEditor | null>, document: NavigationDocument | undefined, firstLine: number): void {
  const nav = useCodeNavigation();
  useEffect(() => {
    const target = document && nav?.target(document.source);
    if (nav && document && target && editor.current) return nav.register({ ...document, target, firstLine, editor: editor.current });
  }, [nav?.register, document?.path, document?.source, firstLine]);
}

export function ClassSearchButton() {
  const nav = useCodeNavigation();
  return nav && <>{!nav.covered&&nav.canForward&&<button onClick={nav.forward} aria-label="다음 코드 위치" title="다음 코드 위치, Alt+Right">→</button>}<button onClick={nav.search} className="class-search-button" title="클래스 검색, Cmd+O 또는 Ctrl+O" data-testid="class-search-button">⌕ 클래스 검색 <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} O</kbd></button></>;
}
