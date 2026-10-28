import { Parser, Language as TsLanguage, type Tree } from "web-tree-sitter";
import { createRequire } from "node:module";
import type { Language } from "../types.js";

const require = createRequire(import.meta.url);

const WASM: Record<Language, string> = {
  java: "tree-sitter-java/tree-sitter-java.wasm",
  kotlin: "@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm",
};

let initialized: Promise<void> | null = null;
const languages = new Map<Language, Promise<TsLanguage>>();
const parsers = new Map<Language, Parser>();

async function loadLanguage(lang: Language): Promise<TsLanguage> {
  initialized ??= Parser.init();
  await initialized;
  let p = languages.get(lang);
  if (!p) {
    p = TsLanguage.load(require.resolve(WASM[lang]));
    languages.set(lang, p);
  }
  return p;
}

export async function parse(lang: Language, text: string): Promise<Tree> {
  let parser = parsers.get(lang);
  if (!parser) {
    const language = await loadLanguage(lang); // Parser.init()이 끝난 뒤에만 Parser를 만들 수 있다
    parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
  const tree = parser.parse(text);
  if (!tree) throw new Error(`parse failed (${lang})`);
  return tree;
}
