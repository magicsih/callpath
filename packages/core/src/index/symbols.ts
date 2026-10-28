import type { Node, Tree } from "web-tree-sitter";
import type { CallSite, Language, SymbolRef } from "../types.js";

export interface MethodSymbol extends SymbolRef {
  language: Language;
  /** 시그니처 줄 범위(본문 제외) */
  signature: { startLine: number; endLine: number };
  /** 본문 범위. 추상 메서드면 null */
  body: { startLine: number; endLine: number } | null;
  calls: CallSite[];
  /** 본문 텍스트에서 공백을 제거한 것. 이름 변경 짝짓기에 쓴다 */
  bodyFingerprint: string;
}

interface LanguageSpec {
  packageNode: string;
  containerNodes: Set<string>;
  methodNodes: Set<string>;
  bodyNodes: Set<string>;
  controlNodes: Set<string>;
  blockNodes: Set<string>;
  nameOf(node: Node): string | null;
  paramsOf(node: Node): number;
  callOf(node: Node): { name: string; arity: number } | null;
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
  nameOf: (n) => n.childForFieldName("name")?.text ?? null,
  paramsOf: (n) => countNamed(n.childForFieldName("parameters"), ["formal_parameter", "spread_parameter", "receiver_parameter"]),
  callOf: (n) => {
    if (n.type === "method_invocation") {
      const name = n.childForFieldName("name")?.text;
      return name ? { name, arity: countArgs(n.childForFieldName("arguments")) } : null;
    }
    if (n.type === "object_creation_expression") {
      const type = n.childForFieldName("type")?.text;
      return type ? { name: `new ${type}`, arity: countArgs(n.childForFieldName("arguments")) } : null;
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
  nameOf: (n) => {
    if (n.type === "secondary_constructor") return "constructor";
    if (n.type === "anonymous_initializer") return "init";
    return firstChildOfType(n, ["identifier", "simple_identifier", "type_identifier"])?.text ?? null;
  },
  paramsOf: (n) => countNamed(firstChildOfType(n, ["function_value_parameters", "class_parameters"]), ["parameter", "class_parameter"]),
  callOf: (n) => {
    if (n.type !== "call_expression") return null;
    const callee = n.children[0];
    if (!callee) return null;
    let name: string | null = null;
    if (callee.type === "identifier" || callee.type === "simple_identifier") name = callee.text;
    else if (callee.type === "navigation_expression") {
      const parts = callee.children.filter((c) => c.type === "identifier" || c.type === "simple_identifier" || c.type === "navigation_suffix");
      const last = parts[parts.length - 1];
      name = last ? (last.type === "navigation_suffix" ? firstChildOfType(last, ["identifier", "simple_identifier"])?.text ?? null : last.text) : null;
    }
    if (!name) return null;
    const args = firstChildOfType(n, ["value_arguments", "call_suffix"]);
    const valueArgs = args?.type === "call_suffix" ? firstChildOfType(args, ["value_arguments"]) : args;
    const lambda = n.children.some((c) => c.type === "annotated_lambda" || c.type === "lambda_literal") ||
      (args?.type === "call_suffix" && args.children.some((c) => c.type === "annotated_lambda"));
    return { name, arity: countNamed(valueArgs, ["value_argument"]) + (lambda ? 1 : 0) };
  },
};

const SPECS: Record<Language, LanguageSpec> = { java: JAVA, kotlin: KOTLIN };

function firstChildOfType(n: Node | null, types: string[]): Node | null {
  if (!n) return null;
  for (const c of n.children) if (types.includes(c.type)) return c;
  return null;
}

function countNamed(n: Node | null, types: string[]): number {
  if (!n) return 0;
  return n.children.filter((c) => types.includes(c.type)).length;
}

function countArgs(args: Node | null): number {
  return args ? args.namedChildren.filter((c) => c.type !== "line_comment" && c.type !== "block_comment").length : 0;
}

/** 파일 하나에서 메서드 심볼과 그 안의 호출문 시퀀스를 뽑는다. */
export function extractMethods(path: string, language: Language, tree: Tree): MethodSymbol[] {
  const spec = SPECS[language];
  const root = tree.rootNode;
  const pkg = firstChildOfType(root, [spec.packageNode]);
  const pkgName = pkg ? pkg.text.replace(/^package\s+/, "").replace(/;.*$/s, "").trim() : "";
  const out: MethodSymbol[] = [];

  const visit = (node: Node, containers: string[]): void => {
    if (spec.containerNodes.has(node.type)) {
      const name = spec.nameOf(node) ?? "<anonymous>";
      for (const c of node.children) visit(c, [...containers, name]);
      return;
    }
    if (spec.methodNodes.has(node.type)) {
      out.push(toSymbol(path, language, spec, node, pkgName, containers));
      // 메서드 안의 지역 클래스, 람다 안 메서드는 2단계에서 다룬다
      return;
    }
    for (const c of node.children) visit(c, containers);
  };
  visit(root, []);
  return out;
}

function toSymbol(path: string, language: Language, spec: LanguageSpec, node: Node, pkg: string, containers: string[]): MethodSymbol {
  const name = spec.nameOf(node) ?? "<anonymous>";
  const container = containers.length ? containers.join(".") : null;
  const qualified = [pkg, container, name].filter(Boolean).join(".");
  const body = firstChildOfType(node, [...spec.bodyNodes]);
  const bodyRange = body ? { startLine: body.startPosition.row, endLine: body.endPosition.row } : null;
  const calls: CallSite[] = [];
  if (body) collectCalls(spec, body, 0, null, calls, true);
  return {
    path,
    language,
    qualifiedName: qualified,
    name,
    container,
    arity: spec.paramsOf(node),
    range: { startLine: node.startPosition.row, endLine: node.endPosition.row },
    signature: { startLine: node.startPosition.row, endLine: body ? Math.max(node.startPosition.row, body.startPosition.row) : node.endPosition.row },
    body: bodyRange,
    calls,
    bodyFingerprint: body ? body.text.replace(/\s+/g, "") : "",
  };
}

function collectCalls(spec: LanguageSpec, node: Node, depth: number, control: string | null, out: CallSite[], isRoot: boolean): void {
  const call = spec.callOf(node);
  if (call) {
    // 중첩 호출은 바깥 호출을 먼저 기록하고 인자 안의 호출도 소스 순서대로 이어서 기록한다
    out.push({ ...call, depth, control, line: node.startPosition.row });
  }
  let nextDepth = depth;
  let nextControl = control;
  if (!isRoot && spec.blockNodes.has(node.type)) nextDepth = depth + 1;
  if (spec.controlNodes.has(node.type)) nextControl = node.type;
  for (const c of node.children) collectCalls(spec, c, nextDepth, nextControl, out, false);
}
