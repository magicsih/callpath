import type { CallGraph } from "../graph/callGraph.js";
import { methodId } from "../graph/callGraph.js";
import type { Annotation, ClassSymbol, MethodSymbol } from "../index/symbols.js";
import type { EntryRule } from "../config.js";
import type { EntryKind } from "../types.js";

export interface EntryPoint {
  id: string;
  method: MethodSymbol;
  kind: Exclude<EntryKind, "unknown">;
  label: string;
}

const HTTP_VERBS: Record<string, string | null> = {
  GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT", DeleteMapping: "DELETE", PatchMapping: "PATCH", RequestMapping: null,
};
const CONTROLLERS = new Set(["RestController", "Controller"]);
const MESSAGE: Record<string, { prefix: string; keys: string[] }> = {
  KafkaListener: { prefix: "Kafka", keys: ["topics", "value", "topicPattern"] },
  RabbitListener: { prefix: "RabbitMQ", keys: ["queues", "value"] },
  SqsListener: { prefix: "SQS", keys: ["value", "queueNames"] },
  JmsListener: { prefix: "JMS", keys: ["destination"] },
};
const EVENTS = new Set(["EventListener", "TransactionalEventListener"]);

/** 설계 5.3 진입점 감지. 테스트 메서드는 진입점이 되지 않는다. */
export function detectEntries(graph: CallGraph, isTest: (m: MethodSymbol) => boolean, rules: EntryRule[] = []): EntryPoint[] {
  const out: EntryPoint[] = [];
  for (const m of graph.methods.values()) {
    if (isTest(m) || m.synthetic) continue;
    const cls = m.classQualifiedName ? graph.classes.get(m.classQualifiedName) ?? null : null;
    const found = classify(m, cls, rules);
    if (found) out.push({ id: methodId(m), method: m, ...found });
  }
  return out;
}

function classify(m: MethodSymbol, cls: ClassSymbol | null, rules: EntryRule[]): { kind: EntryPoint["kind"]; label: string } | null {
  const owner = cls?.name ?? m.path.split("/").pop()!.replace(/\.\w+$/, "");
  const where = `${owner}.${m.name}`;

  for (const rule of rules) {
    const a = m.annotations.find((x) => x.name === rule.annotation);
    if (a) return { kind: rule.kind, label: `${rule.prefix ?? rule.annotation} ${firstValue(a) ?? where}` };
  }

  if (cls && cls.annotations.some((a) => CONTROLLERS.has(a.name))) {
    const mapping = m.annotations.find((a) => a.name in HTTP_VERBS);
    if (mapping) {
      const classMapping = cls.annotations.find((a) => a.name === "RequestMapping");
      const path = joinPath(classMapping ? mappingPath(classMapping) : "", mappingPath(mapping));
      return { kind: "http", label: `${httpVerb(mapping)} ${path}` };
    }
  }

  for (const a of m.annotations) {
    const msg = MESSAGE[a.name];
    if (msg) {
      const names = msg.keys.map((k) => a.named[k]).find((v) => v && v.length) ?? (a.positional.length ? a.positional : null);
      return { kind: "message", label: `${msg.prefix} ${names ? names.join(", ") : where}` };
    }
  }

  if (m.annotations.some((a) => a.name === "Scheduled")) return { kind: "schedule", label: `Scheduled ${where}` };

  if (m.annotations.some((a) => EVENTS.has(a.name))) {
    const ev = m.annotations.find((a) => EVENTS.has(a.name))!;
    const type = m.params[0]?.type ?? ev.named["classes"]?.[0]?.replace(/::class|\.class/g, "") ?? where;
    return { kind: "event", label: `Event ${type}` };
  }

  const grpcBase = cls?.supertypes.find((s) => /ImplBase$/.test(s));
  if (grpcBase && m.isOverride && m.visibility === "public") {
    return { kind: "grpc", label: `gRPC ${grpcBase.replace(/(Coroutine)?ImplBase$/, "")}/${m.name}` };
  }

  if (m.name === "main") {
    const javaMain = m.language === "java" && m.isStatic && m.visibility === "public" && m.arity === 1;
    const kotlinMain = m.language === "kotlin" && m.classQualifiedName === null && m.arity <= 1;
    if (javaMain || kotlinMain) return { kind: "main", label: `main ${owner}` };
  }
  return null;
}

function firstValue(a: Annotation): string | null {
  return a.positional[0] ?? Object.values(a.named)[0]?.[0] ?? null;
}

function mappingPath(a: Annotation): string {
  return a.named["path"]?.[0] ?? a.named["value"]?.[0] ?? a.positional[0] ?? "";
}

function httpVerb(a: Annotation): string {
  const fixed = HTTP_VERBS[a.name];
  if (fixed) return fixed;
  const raw = (a.named["method"] ?? []).join(",");
  const verbs = [...raw.matchAll(/RequestMethod\.(\w+)/g)].map((x) => x[1]!);
  return verbs.length ? verbs.join("|") : "ANY";
}

function joinPath(a: string, b: string): string {
  const joined = `/${a}/${b}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}
