import { parse as parseYaml } from "yaml";
import type { FileSource } from "./source/fileSource.js";
import type { EntryKind } from "./types.js";

export const CONFIG_FILE = ".callpath.yml";

export interface EntryRule {
  /** 메서드에 달린 애노테이션의 단순 이름 */
  annotation: string;
  kind: Exclude<EntryKind, "unknown">;
  /** 흐름 라벨 앞에 붙일 말. 없으면 애노테이션 이름 */
  prefix?: string;
}

export interface CallpathConfig {
  entries: EntryRule[];
}

const KINDS = new Set(["http", "message", "schedule", "event", "grpc", "main"]);

export function parseConfig(text: string): CallpathConfig {
  const raw = parseYaml(text) as unknown;
  const entries: EntryRule[] = [];
  const list = raw && typeof raw === "object" && "entries" in raw ? (raw as { entries: unknown }).entries : [];
  if (!Array.isArray(list)) throw new Error(`${CONFIG_FILE}: entries는 목록이어야 합니다`);
  for (const [i, item] of list.entries()) {
    const r = item as Partial<EntryRule>;
    if (typeof r.annotation !== "string" || !r.annotation) throw new Error(`${CONFIG_FILE}: entries[${i}].annotation이 필요합니다`);
    if (typeof r.kind !== "string" || !KINDS.has(r.kind)) throw new Error(`${CONFIG_FILE}: entries[${i}].kind는 ${[...KINDS].join(", ")} 중 하나여야 합니다`);
    entries.push({ annotation: r.annotation.replace(/^@/, ""), kind: r.kind, ...(typeof r.prefix === "string" ? { prefix: r.prefix } : {}) });
  }
  return { entries };
}

/** head 시점 저장소 루트의 설정 파일을 읽는다. 없으면 기본값 */
export async function loadConfig(head: FileSource): Promise<CallpathConfig> {
  const files = await head.listFiles();
  if (!files.includes(CONFIG_FILE)) return { entries: [] };
  return parseConfig(await head.read(CONFIG_FILE));
}
