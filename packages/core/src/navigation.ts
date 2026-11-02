import type { Node } from "web-tree-sitter";
import { languageOf } from "./diff/fileChanges.js";
import { isTestFile } from "./classify/test.js";
import { listGuideFiles } from "./guide/guide.js";
import { indexFile, type ClassKind, type FileIndex } from "./index/symbols.js";
import { parse } from "./index/parser.js";
import type { FileSource } from "./source/fileSource.js";
import type { Range } from "./types.js";

/** 위치는 파서와 같은 0부터 시작한다. 화면 경계에서만 1을 더한다. */
export interface NavigationClass {
  id: string; name: string; qualifiedName: string; packageName: string; path: string;
  kind: ClassKind; range: Range; namePos: { line: number; column: number };
  abstract: boolean; test: boolean; parentIds: string[]; unresolvedParents: string[];
}
export type NavigationQuery =
  | { kind: "search"; query: string; limit?: number }
  | { kind: "definition" | "implementations"; path: string; position: { line: number; column: number } }
  | { kind: "implementors" | "parents"; id: string };
export interface NavigationReply { items: NavigationClass[]; total: number; chooseType?: boolean }
type Reference = { line: number; column: number; end: number; name: string; owner: string | null; declaration?: string };
type File = { index: FileIndex; imports: Array<{ name: string; path: string; wildcard: boolean }>; refs: Reference[] };
const natural = (a: NavigationClass, b: NavigationClass) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.qualifiedName.localeCompare(b.qualifiedName) || a.path.localeCompare(b.path);
const simple = (text: string) => text.replace(/<.*$/s, "").replace(/\(.*$/s, "").replace(/`([^`]+)`|[?\s]/g, (_all, quoted: string | undefined) => quoted ?? "");
const walk = (node: Node, visit: (n: Node) => void) => { visit(node); for (const c of node.namedChildren) walk(c, visit); };

export class NavigationIndex {
  constructor(private classes: NavigationClass[], private files: Map<string, File>) {}
  private named(name: string) { return this.classes.filter(c => c.qualifiedName === name); }

  private resolve(file: File, name: string, owner: string | null): NavigationClass[] {
    name = simple(name);
    const first = name.split(".")[0]!;
    if (name.includes(".") && /^[a-z]/.test(first)) return this.named(name);
    let scope = owner;
    while (scope && (scope === file.index.packageName || scope.startsWith(file.index.packageName ? file.index.packageName + "." : ""))) {
      const nested = this.named(scope + "." + name); if (nested.length) return nested;
      scope = scope.includes(".") ? scope.slice(0, scope.lastIndexOf(".")) : null;
      if (scope === file.index.packageName) break;
    }
    // 중첩 선언을 먼저 찾고, 명시된 외부 import를 동명 로컬 타입으로 대체하지 않는다.
    const imported = file.imports.filter(i => !i.wildcard && i.name === first);
    if (imported.length) return imported.flatMap(i => this.named(i.path + name.slice(first.length)));
    const local = this.named([file.index.packageName, name].filter(Boolean).join("."));
    if (local.length) return local;
    const wildcard = file.imports.filter(i => i.wildcard).flatMap(i => this.named(i.path + "." + name));
    if (wildcard.length) return [...new Map(wildcard.map(c => [c.id, c])).values()].sort(natural);
    return ["java.lang", "kotlin"].flatMap(p => this.named(p + "." + name));
  }

  /** 색인을 만든 뒤 한 번만 상속 관계를 확정한다. 모호한 상속은 연결하지 않는다. */
  link(parents: Map<string, string[]>): void {
    for (const c of this.classes) for (const name of parents.get(c.id) ?? []) {
      const found = this.resolve(this.files.get(c.path)!, name, c.qualifiedName);
      if (found.length === 1 && found[0]!.id !== c.id) c.parentIds.push(found[0]!.id);
      else c.unresolvedParents.push(name);
    }
  }

  query(query: NavigationQuery): NavigationReply {
    const reply = (items: NavigationClass[]): NavigationReply => ({ items, total: items.length });
    const implementations = (ids: string[]) => {
      const family = new Set(ids);
      for (let changed = true; changed;) {
        changed = false;
        for (const c of this.classes) if (!family.has(c.id) && c.parentIds.some(p => family.has(p))) { family.add(c.id); changed = true; }
      }
      return this.classes.filter(c => family.has(c.id) && !ids.includes(c.id)).sort(natural);
    };
    if (query.kind === "search") {
      const q = query.query.trim().toLocaleLowerCase();
      const rank = (c: NavigationClass) => [c.name, c.qualifiedName].some(n => n.toLocaleLowerCase() === q) ? 0 : c.name.toLocaleLowerCase().startsWith(q) ? 1 : 2;
      const items = this.classes.filter(c => `${c.name} ${c.qualifiedName} ${c.path}`.toLocaleLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || natural(a, b));
      return { items: items.slice(0, Math.max(1, query.limit ?? 100)), total: items.length };
    }
    if ("id" in query) return query.kind === "parents" ? reply((this.classes.find(c => c.id === query.id)?.parentIds ?? []).flatMap(id => this.classes.filter(c => c.id === id)).sort(natural)) : reply(implementations([query.id]));
    const f = this.files.get(query.path); if (!f) return reply([]);
    const ref = f.refs.find(r => r.line === query.position.line && r.column <= query.position.column && query.position.column < r.end);
    const found = ref ? ref.declaration ? this.classes.filter(c => c.id === ref.declaration) : this.resolve(f, ref.name, ref.owner) : [];
    if (query.kind === "definition") return reply(found);
    return found.length === 1 ? reply(implementations([found[0]!.id])) : { ...reply(found), chooseType: found.length > 1 };
  }
}

/** 기존 클래스 파서를 재사용하며 트리 노드는 이 함수 밖에 보관하지 않는다. */
export async function createNavigation(source: FileSource, dir?: string): Promise<NavigationIndex> {
  const { paths } = await listGuideFiles(source, dir);
  const texts = await source.readMany(paths);
  const classes: NavigationClass[] = [], files = new Map<string, File>(), parents = new Map<string, string[]>();
  for (const path of paths) {
    const language = languageOf(path)!;
    const tree = await parse(language, texts.get(path)!);
    try {
      const index = indexFile(path, language, tree);
      index.packageName = index.packageName.replace(/`/g, "");
      for (const c of index.classes) { c.name = c.name.replace(/`/g, ""); c.qualifiedName = c.qualifiedName.replace(/`/g, ""); }
      for (const m of index.methods) if (m.classQualifiedName) m.classQualifiedName = m.classQualifiedName.replace(/`/g, "");
      if (index.classes.some(c => c.annotations.some(a => a.name === "Generated"))) continue;
      const file: File = { index, imports: [], refs: [] };
      files.set(path, file);
      const declarations = new Map<number, NavigationClass>(), nodes = new Map<number, NavigationClass>();
      walk(tree.rootNode, node => {
        if (["import_declaration", "import"].includes(node.type)) {
          const qualified = node.namedChildren.find(n => ["identifier","scoped_identifier","qualified_identifier"].includes(n.type));
          if (qualified) {
            const parts: string[] = [];
            walk(qualified, n => { if (n.type === "identifier" && n.namedChildCount === 0) parts.push(n.text.replace(/`/g,"")); });
            const target = parts.join("."), alias = /\bas\s+/.test(node.text) ? node.namedChildren.at(-1)?.text.replace(/`/g,"") : null;
            file.imports.push({ path: target, name: alias ?? parts.at(-1)!, wildcard: /\.\s*\*/.test(node.text) });
          }
        }
        if (!["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration", "object_declaration", "companion_object"].includes(node.type)) return;
        const name = node.childForFieldName("name") ?? node.namedChildren.find(n => ["identifier","type_identifier"].includes(n.type));
        const spelling = name?.text.replace(/`/g, "") ?? (node.type === "companion_object" ? "Companion" : null);
        const symbol = index.classes.find(c => c.name === spelling && c.range.startLine === node.startPosition.row && c.range.endLine === node.endPosition.row);
        if (!symbol) return;
        const c: NavigationClass = { id: `${path}#${symbol.qualifiedName}`, name: symbol.qualifiedName.slice(index.packageName ? index.packageName.length + 1 : 0), qualifiedName: symbol.qualifiedName,
          packageName: index.packageName, path, kind: symbol.kind, range: symbol.range, namePos: { line: (name??node).startPosition.row, column: (name??node).startPosition.column },
          abstract: symbol.kind === "interface" || node.namedChildren.some(n => n.type === "modifiers" && /\babstract\b/.test(n.text)), test: isTestFile(index), parentIds: [], unresolvedParents: [] };
        classes.push(c); if(name) declarations.set(name.id, c); nodes.set(node.id, c);
        const supers: string[] = [];
        if (language === "java") {
          for (const child of node.namedChildren.filter(n => ["superclass", "super_interfaces", "extends_interfaces"].includes(n.type))) {
            const list = child.namedChildren.find(n => n.type === "type_list");
            for (const t of (list ?? child).namedChildren) supers.push(t.text);
          }
        } else {
          for (const child of node.namedChildren.filter(n => n.type === "delegation_specifiers").flatMap(n => n.namedChildren)) {
            const type = child.namedChildren.find(n => n.type === "user_type") ?? child.namedChildren.find(n => n.type === "constructor_invocation")?.namedChildren.find(n => n.type === "user_type");
            if (type) supers.push(type.text);
          }
        }
        parents.set(c.id, supers);
      });
      const visit = (node: Node, owner: NavigationClass | null): void => {
        owner = nodes.get(node.id) ?? owner;
        if (/comment|string|character_literal/.test(node.type)) return;
        if (["identifier", "type_identifier", "simple_identifier"].includes(node.type) && node.namedChildCount === 0) {
          let type: Node | null = null, imported: Node | null = null, annotation: Node | null = null, expressionType: Node | null = null, p = node.parent;
          while (p && p !== tree.rootNode) {
            if (["user_type", "scoped_type_identifier"].includes(p.type) && !type) type = p;
            if (["import_declaration", "import"].includes(p.type)) imported = p;
            if (["marker_annotation","annotation"].includes(p.type)) {
              const name = p.childForFieldName("name");
              if (name && name.startIndex <= node.startIndex && node.endIndex <= name.endIndex) annotation = name;
            }
            if (["field_access","navigation_expression"].includes(p.type)) expressionType = p;
            if (p.type.endsWith("body") || p.type === "block") break;
            p = p.parent;
          }
          const decl = declarations.get(node.id);
          let parameter = false, ancestor = node.parent;
          while (ancestor) {
            const parameters = ancestor.namedChildren.find(n=>n.type === "type_parameters");
            if (parameters?.namedChildren.some(n=>n.namedChildren.find(p=>["identifier","type_identifier"].includes(p.type))?.text===node.text)) parameter = true;
            ancestor = ancestor.parent;
          }
          const expression = /^[A-Z]/.test(node.text) && ["call_expression", "navigation_expression", "field_access"].includes(node.parent?.type ?? "");
          const shadow = owner && index.methods.some(m => m.classQualifiedName === owner!.qualifiedName && (m.name === node.text || m.range.startLine <= node.startPosition.row && node.startPosition.row <= m.range.endLine && (m.params.some(p => p.name === node.text) || node.text in m.locals))) || owner && index.classes.find(c => c.qualifiedName === owner!.qualifiedName)?.fields[node.text];
          if (decl || !parameter && (type || node.type === "type_identifier" || imported || annotation || expression && !shadow)) {
            let name = node.text;
            if (type) name = type.text.slice(0, node.endIndex - type.startIndex);
            else if (annotation) name = annotation.text.slice(0,node.endIndex-annotation.startIndex);
            else if (imported) name = /\bas\s+/.test(imported.text) && imported.namedChildren.at(-1)?.id === node.id ? node.text : imported.text.replace(/^import\s+(?:static\s+)?/, "").slice(0, node.endIndex - imported.startIndex - (imported.text.match(/^import\s+(?:static\s+)?/)?.[0].length ?? 0));
            else if (expressionType) name = expressionType.text.slice(0,node.endIndex-expressionType.startIndex);
            file.refs.push({ line: node.startPosition.row, column: node.startPosition.column, end: node.endPosition.column, name, owner: owner?.qualifiedName ?? null, ...(decl ? { declaration: decl.id } : {}) });
          }
        }
        for (const child of node.namedChildren) visit(child, owner);
      };
      visit(tree.rootNode, null);
    } finally { tree.delete(); }
  }
  const result = new NavigationIndex(classes, files); result.link(parents); return result;
}
