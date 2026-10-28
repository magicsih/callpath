import { Parser, Language } from "web-tree-sitter";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [,, lang, file, maxDepth="6"] = process.argv;
await Parser.init();
const wasm = lang === "java" ? require.resolve("tree-sitter-java/tree-sitter-java.wasm") : require.resolve("@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm");
const L = await Language.load(wasm);
const p = new Parser(); p.setLanguage(L);
const tree = p.parse(readFileSync(file, "utf8"));
function dump(n, d) { if (d > +maxDepth) return; const t = n.text.replace(/\s+/g," ").slice(0,40); console.log(" ".repeat(d*2) + n.type + (n.isNamed?"":"*") + "  «" + t + "»"); for (const c of n.children) dump(c, d+1); }
dump(tree.rootNode, 0);
