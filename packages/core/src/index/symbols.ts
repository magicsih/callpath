import type { Node, Tree } from "web-tree-sitter";
import type { CallSite, Language, Range, SymbolRef } from "../types.js";

export interface Annotation {
  /** 마지막 이름 조각. 예: @org.springframework...PostMapping → PostMapping */
  name: string;
  positional: string[];
  named: Record<string, string[]>;
}

export interface ClassSymbol {
  path: string;
  language: Language;
  qualifiedName: string;
  name: string;
  range: Range;
  annotations: Annotation[];
  /** 상위 타입의 단순 이름 */
  supertypes: string[];
  /** 필드 이름 → 단순 타입 이름 */
  fields: Record<string, string>;
}

export interface MethodSymbol extends SymbolRef {
  language: Language;
  /** 시그니처 줄 범위(본문 제외) */
  signature: Range;
  /** 본문 범위. 추상 메서드면 null */
  body: Range | null;
  calls: CallSite[];
  /** 본문 텍스트에서 공백을 제거한 것. 본문 변경 판정과 이름 변경 짝짓기에 쓴다 */
  bodyFingerprint: string;
  annotations: Annotation[];
  visibility: "public" | "protected" | "private" | "internal" | "package";
  isStatic: boolean;
  isOverride: boolean;
  params: Array<{ name: string; type: string }>;
  /** 지역 변수 이름 → 단순 타입 이름 */
  locals: Record<string, string>;
  /** 소속 클래스의 qualifiedName. Kotlin 최상위 함수면 null */
  classQualifiedName: string | null;
  /** Kotest 스펙 생성자 람다처럼 메서드가 아니지만 테스트 본문인 것 */
  synthetic?: "spec";
}

export interface FileIndex {
  path: string;
  language: Language;
  packageName: string;
  classes: ClassSymbol[];
  methods: MethodSymbol[];
}

const KOTEST_SPECS = new Set([
  "StringSpec", "FunSpec", "DescribeSpec", "BehaviorSpec", "ShouldSpec", "WordSpec",
  "FreeSpec", "FeatureSpec", "ExpectSpec", "AnnotationSpec",
]);

/** 단순 타입 이름. 제네릭, 널 가능 표시, 배열, 패키지 경로를 뗀다. */
export function simpleType(text: string): string {
  let t = text.trim();
  const lt = t.indexOf("<");
  if (lt >= 0) t = t.slice(0, lt);
  t = t.replace(/[?\[\]\s]/g, "");
  const dot = t.lastIndexOf(".");
  return dot >= 0 ? t.slice(dot + 1) : t;
}

function childrenOfType(n: Node | null, types: string[]): Node[] {
  return n ? n.children.filter((c) => types.includes(c.type)) : [];
}

function firstChildOfType(n: Node | null, types: string[]): Node | null {
  return childrenOfType(n, types)[0] ?? null;
}

// ---------- 애노테이션 ----------

function parseAnnotation(node: Node, extraArgs?: string): Annotation {
  const text = node.text;
  const m = /^@(?:\w+:)?([\w.]+)/.exec(text);
  const full = m?.[1] ?? "";
  const name = full.slice(full.lastIndexOf(".") + 1);
  const open = text.indexOf("(");
  const args = extraArgs ?? (open >= 0 ? text.slice(open) : "");
  return { name, ...parseArgs(args) };
}

function parseArgs(args: string): { positional: string[]; named: Record<string, string[]> } {
  const inner = args.trim().replace(/^\(/, "").replace(/\)$/, "");
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      cur += ch;
      if (ch === "\\") { cur += inner[++i] ?? ""; continue; }
      if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const positional: string[] = [];
  const named: Record<string, string[]> = {};
  for (const part of parts) {
    const kv = /^\s*(\w+)\s*=\s*([\s\S]*)$/.exec(part);
    const values = (raw: string) => {
      const strings = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]!);
      return strings.length ? strings : [raw.trim()];
    };
    if (kv) named[kv[1]!] = values(kv[2]!);
    else positional.push(...values(part));
  }
  return { positional, named };
}

function javaAnnotations(modifiers: Node | null): Annotation[] {
  return childrenOfType(modifiers, ["annotation", "marker_annotation"]).map((a) => parseAnnotation(a));
}

function kotlinAnnotations(modifiers: Node | null): Annotation[] {
  return childrenOfType(modifiers, ["annotation"]).map((a) => parseAnnotation(a));
}

/**
 * import 없이 package 바로 뒤에 애노테이션 달린 클래스가 오면 tree-sitter-kotlin이 애노테이션을
 * 클래스 앞의 annotated_expression 형제로 파싱한다. 그 형제에서 애노테이션을 거둔다.
 */
function kotlinDetachedAnnotations(classNode: Node): Annotation[] {
  const prev = classNode.previousNamedSibling;
  if (!prev || prev.type !== "annotated_expression") return [];
  const out: Annotation[] = [];
  const walk = (n: Node): void => {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)!;
      if (c.type === "annotation") {
        const next = c.nextNamedSibling;
        const args = next && next.type === "parenthesized_expression" ? next.text : undefined;
        out.push(parseAnnotation(c, args));
      } else if (c.type === "annotated_expression") walk(c);
    }
  };
  walk(prev);
  return out;
}

// ---------- 언어별 규칙 ----------

interface LanguageSpec {
  packageNode: string;
  containerNodes: Set<string>;
  methodNodes: Set<string>;
  bodyNodes: Set<string>;
  controlNodes: Set<string>;
  blockNodes: Set<string>;
  className(n: Node): string;
  classInfo(n: Node): { annotations: Annotation[]; supertypes: string[]; fields: Record<string, string> };
  methodName(n: Node): string;
  methodInfo(n: Node, body: Node | null): Pick<MethodSymbol, "annotations" | "visibility" | "isStatic" | "isOverride" | "params" | "locals">;
  callOf(n: Node): { name: string; arity: number; receiver: string | null } | null;
}

const JAVA: LanguageSpec = {
  packageNode: "package_declaration",
  containerNodes: new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"]),
  methodNodes: new Set(["method_declaration", "constructor_declaration", "compact_constructor_declaration"]),
  bodyNodes: new Set(["block", "constructor_body"]),
  controlNodes: new Set([
    "if_statement", "for_statement", "enhanced_for_statement", "while_statement", "do_statement",
    "try_statement", "try_with_resources_statement", "catch_clause", "finally_clause",
    "switch_expression", "switch_block", "lambda_expression", "ternary_expression", "synchronized_statement",
  ]),
  blockNodes: new Set(["block", "constructor_body", "switch_block", "lambda_expression"]),
  className: (n) => n.childForFieldName("name")?.text ?? "<anonymous>",
  classInfo: (n) => {
    const supertypes: string[] = [];
    const sup = n.childForFieldName("superclass");
    if (sup) supertypes.push(...sup.namedChildren.map((c) => simpleType(c.text)));
    for (const field of ["interfaces", "extends_interfaces"]) {
      const list = n.childForFieldName(field) ?? firstChildOfType(n, [field === "interfaces" ? "super_interfaces" : "extends_interfaces"]);
      const types = firstChildOfType(list, ["type_list"]);
      if (types) supertypes.push(...types.namedChildren.map((c) => simpleType(c.text)));
    }
    const fields: Record<string, string> = {};
    const record = n.type === "record_declaration" ? n.childForFieldName("parameters") : null;
    for (const p of childrenOfType(record, ["formal_parameter"])) {
      const name = p.childForFieldName("name")?.text;
      const type = p.childForFieldName("type")?.text;
      if (name && type) fields[name] = simpleType(type);
    }
    for (const f of childrenOfType(n.childForFieldName("body"), ["field_declaration", "constant_declaration"])) {
      const type = f.childForFieldName("type")?.text;
      if (!type) continue;
      for (const d of childrenOfType(f, ["variable_declarator"])) {
        const name = d.childForFieldName("name")?.text;
        if (name) fields[name] = simpleType(type);
      }
    }
    return { annotations: javaAnnotations(firstChildOfType(n, ["modifiers"])), supertypes, fields };
  },
  methodName: (n) => n.childForFieldName("name")?.text ?? "<anonymous>",
  methodInfo: (n, body) => {
    const modifiers = firstChildOfType(n, ["modifiers"]);
    const mods = modifiers ? modifiers.children.filter((c) => !c.isNamed || c.type === "modifier").map((c) => c.text) : [];
    const annotations = javaAnnotations(modifiers);
    const params: Array<{ name: string; type: string }> = [];
    for (const p of childrenOfType(n.childForFieldName("parameters"), ["formal_parameter", "spread_parameter"])) {
      const name = p.childForFieldName("name")?.text ?? firstChildOfType(p, ["variable_declarator"])?.childForFieldName("name")?.text;
      const typeNode = p.childForFieldName("type") ?? p.namedChildren.find((c) => c.type.endsWith("type") || c.type === "type_identifier");
      if (name && typeNode) params.push({ name, type: simpleType(typeNode.text) });
    }
    const locals: Record<string, string> = {};
    if (body) {
      for (const decl of body.descendantsOfType("local_variable_declaration")) {
        const type = decl.childForFieldName("type")?.text;
        if (!type) continue;
        for (const d of childrenOfType(decl, ["variable_declarator"])) {
          const name = d.childForFieldName("name")?.text;
          if (!name) continue;
          if (type === "var") {
            const value = d.childForFieldName("value");
            const created = value?.type === "object_creation_expression" ? value.childForFieldName("type")?.text : null;
            if (created) locals[name] = simpleType(created);
          } else locals[name] = simpleType(type);
        }
      }
      for (const loop of body.descendantsOfType("enhanced_for_statement")) {
        const name = loop.childForFieldName("name")?.text;
        const type = loop.childForFieldName("type")?.text;
        if (name && type && type !== "var") locals[name] = simpleType(type);
      }
    }
    const visibility = mods.includes("public") ? "public" : mods.includes("private") ? "private" : mods.includes("protected") ? "protected" : "package";
    return {
      annotations,
      visibility,
      isStatic: mods.includes("static"),
      isOverride: annotations.some((a) => a.name === "Override"),
      params,
      locals,
    };
  },
  callOf: (n) => {
    if (n.type === "method_invocation") {
      const name = n.childForFieldName("name")?.text;
      if (!name) return null;
      const obj = n.childForFieldName("object");
      let receiver: string | null = null;
      if (obj?.type === "identifier") receiver = obj.text;
      else if (obj?.type === "this") receiver = "this";
      else if (obj?.type === "super") receiver = "super";
      else if (obj?.type === "field_access" && obj.childForFieldName("object")?.type === "this") receiver = obj.childForFieldName("field")?.text ?? null;
      else if (!obj) receiver = null;
      else receiver = "?";
      return { name, arity: countArgs(n.childForFieldName("arguments")), receiver };
    }
    if (n.type === "object_creation_expression") {
      const type = n.childForFieldName("type")?.text;
      return type ? { name: `new ${simpleType(type)}`, arity: countArgs(n.childForFieldName("arguments")), receiver: null } : null;
    }
    return null;
  },
};

const KOTLIN: LanguageSpec = {
  packageNode: "package_header",
  containerNodes: new Set(["class_declaration", "object_declaration", "companion_object"]),
  methodNodes: new Set(["function_declaration", "secondary_constructor", "anonymous_initializer"]),
  bodyNodes: new Set(["function_body", "block"]),
  controlNodes: new Set([
    "if_expression", "when_expression", "when_entry", "for_statement", "while_statement", "do_while_statement",
    "try_expression", "catch_block", "finally_block", "lambda_literal", "elvis_expression",
  ]),
  blockNodes: new Set(["block", "function_body", "lambda_literal", "when_entry"]),
  className: (n) => {
    if (n.type === "companion_object") return firstChildOfType(n, ["identifier"])?.text ?? "Companion";
    return n.childForFieldName("name")?.text ?? firstChildOfType(n, ["identifier", "type_identifier"])?.text ?? "<anonymous>";
  },
  classInfo: (n) => {
    const annotations = [...kotlinDetachedAnnotations(n), ...kotlinAnnotations(firstChildOfType(n, ["modifiers"]))];
    const supertypes: string[] = [];
    for (const spec of childrenOfType(firstChildOfType(n, ["delegation_specifiers"]), ["delegation_specifier"])) {
      const ut = firstChildOfType(spec, ["user_type"]) ?? firstChildOfType(firstChildOfType(spec, ["constructor_invocation"]), ["user_type"]);
      if (ut) supertypes.push(simpleType(ut.text));
    }
    const fields: Record<string, string> = {};
    const params = firstChildOfType(firstChildOfType(n, ["primary_constructor"]), ["class_parameters"]);
    for (const p of childrenOfType(params, ["class_parameter"])) {
      const isProperty = p.children.some((c) => !c.isNamed && (c.text === "val" || c.text === "var"));
      const name = firstChildOfType(p, ["identifier"])?.text;
      const type = firstChildOfType(p, ["user_type", "nullable_type"])?.text;
      if (isProperty && name && type) fields[name] = simpleType(type);
    }
    for (const prop of childrenOfType(firstChildOfType(n, ["class_body"]), ["property_declaration"])) {
      const t = kotlinPropertyType(prop);
      if (t) fields[t.name] = t.type;
    }
    return { annotations, supertypes, fields };
  },
  methodName: (n) => {
    if (n.type === "secondary_constructor") return "constructor";
    if (n.type === "anonymous_initializer") return "init";
    return n.childForFieldName("name")?.text ?? firstChildOfType(n, ["identifier"])?.text ?? "<anonymous>";
  },
  methodInfo: (n, body) => {
    const modifiers = firstChildOfType(n, ["modifiers"]);
    const vis = firstChildOfType(modifiers, ["visibility_modifier"])?.text;
    const memberMods = childrenOfType(modifiers, ["member_modifier", "inheritance_modifier", "function_modifier"]).map((c) => c.text);
    const params: Array<{ name: string; type: string }> = [];
    for (const p of childrenOfType(firstChildOfType(n, ["function_value_parameters"]), ["parameter"])) {
      const name = firstChildOfType(p, ["identifier"])?.text;
      const type = firstChildOfType(p, ["user_type", "nullable_type", "function_type"])?.text;
      if (name && type) params.push({ name, type: simpleType(type) });
    }
    const locals: Record<string, string> = {};
    if (body) {
      for (const prop of body.descendantsOfType("property_declaration")) {
        const t = kotlinPropertyType(prop);
        if (t) locals[t.name] = t.type;
      }
      for (const loop of body.descendantsOfType("for_statement")) {
        const v = firstChildOfType(loop, ["variable_declaration"]);
        const name = firstChildOfType(v, ["identifier"])?.text;
        const type = firstChildOfType(v, ["user_type", "nullable_type"])?.text;
        if (name && type) locals[name] = simpleType(type);
      }
    }
    return {
      annotations: kotlinAnnotations(modifiers),
      visibility: (vis as MethodSymbol["visibility"] | undefined) ?? "public",
      isStatic: false,
      isOverride: memberMods.includes("override"),
      params,
      locals,
    };
  },
  callOf: (n) => {
    if (n.type !== "call_expression") return null;
    const callee = n.children[0];
    if (!callee) return null;
    let name: string | null = null;
    let receiver: string | null = null;
    if (callee.type === "identifier") name = callee.text;
    else if (callee.type === "navigation_expression") {
      const parts = callee.namedChildren;
      const last = parts[parts.length - 1];
      name = last?.type === "identifier" ? last.text : null;
      const head = parts[0];
      if (parts.length === 2 && head?.type === "identifier") receiver = head.text;
      else if (parts.length === 2 && head?.type === "this_expression") receiver = "this";
      else if (parts.length === 2 && head?.type === "super_expression") receiver = "super";
      else receiver = "?";
    }
    if (!name) return null;
    const args = firstChildOfType(n, ["value_arguments"]);
    const lambda = n.children.some((c) => c.type === "annotated_lambda" || c.type === "lambda_literal");
    return { name, arity: childrenOfType(args, ["value_argument"]).length + (lambda ? 1 : 0), receiver };
  },
};

/** Kotlin property_declaration에서 이름과 타입. 타입이 없으면 대문자로 시작하는 생성자 호출에서 추론한다. */
function kotlinPropertyType(prop: Node): { name: string; type: string } | null {
  const v = firstChildOfType(prop, ["variable_declaration"]);
  const name = firstChildOfType(v, ["identifier"])?.text;
  if (!name) return null;
  const declared = firstChildOfType(v, ["user_type", "nullable_type"])?.text;
  if (declared) return { name, type: simpleType(declared) };
  const init = firstChildOfType(prop, ["call_expression"]);
  const callee = init?.children[0];
  if (callee?.type === "identifier" && /^[A-Z]/.test(callee.text)) return { name, type: callee.text };
  return null;
}

const SPECS: Record<Language, LanguageSpec> = { java: JAVA, kotlin: KOTLIN };

function countArgs(args: Node | null): number {
  return args ? args.namedChildren.filter((c) => c.type !== "line_comment" && c.type !== "block_comment").length : 0;
}

// ---------- 파일 색인 ----------

export function indexFile(path: string, language: Language, tree: Tree): FileIndex {
  const spec = SPECS[language];
  const root = tree.rootNode;
  const pkg = firstChildOfType(root, [spec.packageNode]);
  const packageName = pkg ? pkg.text.replace(/^package\s+/, "").replace(/;[\s\S]*$/, "").trim() : "";
  const classes: ClassSymbol[] = [];
  const methods: MethodSymbol[] = [];

  const visit = (node: Node, containers: string[]): void => {
    if (spec.containerNodes.has(node.type)) {
      const name = spec.className(node);
      const chain = [...containers, name];
      const qualifiedName = [packageName, ...chain].filter(Boolean).join(".");
      const info = spec.classInfo(node);
      classes.push({ path, language, qualifiedName, name, range: rangeOf(node), ...info });
      if (language === "kotlin" && info.supertypes.some((s) => KOTEST_SPECS.has(s))) {
        const spec = kotlinSpecLambda(node);
        if (spec) methods.push(syntheticSpec(path, spec, packageName, chain, qualifiedName));
      }
      for (const c of node.children) visit(c, chain);
      return;
    }
    if (spec.methodNodes.has(node.type)) {
      methods.push(toSymbol(path, language, spec, node, packageName, containers));
      return; // 메서드 안의 지역 클래스와 람다 안 함수는 다루지 않는다
    }
    for (const c of node.children) visit(c, containers);
  };
  visit(root, []);
  return { path, language, packageName, classes, methods };
}

export function extractMethods(path: string, language: Language, tree: Tree): MethodSymbol[] {
  return indexFile(path, language, tree).methods;
}

function rangeOf(n: Node): Range {
  return { startLine: n.startPosition.row, endLine: n.endPosition.row };
}

function toSymbol(path: string, language: Language, spec: LanguageSpec, node: Node, pkg: string, containers: string[]): MethodSymbol {
  const name = spec.methodName(node);
  const container = containers.length ? containers.join(".") : null;
  const classQualifiedName = container ? [pkg, container].filter(Boolean).join(".") : null;
  const body = firstChildOfType(node, [...spec.bodyNodes]) ?? node.childForFieldName("body");
  const calls: CallSite[] = [];
  if (body) collectCalls(spec, body, 0, null, calls, true);
  return {
    path,
    language,
    qualifiedName: [pkg, container, name].filter(Boolean).join("."),
    name,
    container,
    arity: language === "java"
      ? childrenOfType(node.childForFieldName("parameters"), ["formal_parameter", "spread_parameter"]).length
      : childrenOfType(firstChildOfType(node, ["function_value_parameters"]), ["parameter"]).length,
    range: rangeOf(node),
    signature: { startLine: node.startPosition.row, endLine: body ? Math.max(node.startPosition.row, body.startPosition.row) : node.endPosition.row },
    body: body ? rangeOf(body) : null,
    calls,
    bodyFingerprint: body ? body.text.replace(/\s+/g, "") : "",
    classQualifiedName,
    ...spec.methodInfo(node, body),
  };
}

function kotlinSpecLambda(classNode: Node): Node | null {
  for (const d of childrenOfType(firstChildOfType(classNode, ["delegation_specifiers"]), ["delegation_specifier"])) {
    const inv = firstChildOfType(d, ["constructor_invocation"]);
    const args = firstChildOfType(inv, ["value_arguments"]);
    for (const a of childrenOfType(args, ["value_argument"])) {
      const lambda = firstChildOfType(a, ["lambda_literal"]);
      if (lambda) return lambda;
    }
    const trailing = firstChildOfType(inv, ["annotated_lambda"]);
    if (trailing) return firstChildOfType(trailing, ["lambda_literal"]);
  }
  return null;
}

function syntheticSpec(path: string, lambda: Node, pkg: string, chain: string[], classQualifiedName: string): MethodSymbol {
  const calls: CallSite[] = [];
  collectCalls(KOTLIN, lambda, 0, null, calls, true);
  const container = chain.join(".");
  return {
    path,
    language: "kotlin",
    qualifiedName: [pkg, container, "<spec>"].filter(Boolean).join("."),
    name: "<spec>",
    container,
    arity: 0,
    range: rangeOf(lambda),
    signature: { startLine: lambda.startPosition.row, endLine: lambda.startPosition.row },
    body: rangeOf(lambda),
    calls,
    bodyFingerprint: lambda.text.replace(/\s+/g, ""),
    annotations: [],
    visibility: "public",
    isStatic: false,
    isOverride: false,
    params: [],
    locals: {},
    classQualifiedName,
    synthetic: "spec",
  };
}

function collectCalls(spec: LanguageSpec, node: Node, depth: number, control: string | null, out: CallSite[], isRoot: boolean): void {
  const call = spec.callOf(node);
  // 바깥 호출을 먼저 기록하고 인자 안의 호출을 소스 순서대로 이어서 기록한다
  if (call) out.push({ ...call, depth, control, line: node.startPosition.row });
  let nextDepth = depth;
  let nextControl = control;
  if (!isRoot && spec.blockNodes.has(node.type)) nextDepth = depth + 1;
  if (spec.controlNodes.has(node.type)) nextControl = node.type;
  for (const c of node.children) collectCalls(spec, c, nextDepth, nextControl, out, false);
}
