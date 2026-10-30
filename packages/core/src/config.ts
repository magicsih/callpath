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

export type Role = "entry" | "service" | "integration" | "data" | "model" | "config" | "other";

/** 둘러보기 지도의 역할 규칙. 애노테이션이나 이름 끝 중 하나를 쓴다 */
export interface RoleRule {
  annotation?: string;
  suffix?: string;
  role: Role;
}

export interface CallpathConfig {
  entries: EntryRule[];
  roles?: RoleRule[];
}

const KINDS = new Set(["http", "message", "schedule", "event", "grpc", "main"]);
export const ROLES: Role[] = ["entry", "service", "integration", "data", "model", "config", "other"];

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
  const roleList = raw && typeof raw === "object" && "roles" in raw ? (raw as { roles: unknown }).roles : [];
  if (!Array.isArray(roleList)) throw new Error(`${CONFIG_FILE}: roles는 목록이어야 합니다`);
  const roles: RoleRule[] = [];
  for (const [i, item] of roleList.entries()) {
    const r = item as Partial<RoleRule>;
    const annotation = typeof r.annotation === "string" && r.annotation ? r.annotation.replace(/^@/, "") : undefined;
    const suffix = typeof r.suffix === "string" && r.suffix ? r.suffix : undefined;
    if (!annotation === !suffix) throw new Error(`${CONFIG_FILE}: roles[${i}]에는 annotation이나 suffix 중 하나만 적습니다`);
    if (typeof r.role !== "string" || !ROLES.includes(r.role)) throw new Error(`${CONFIG_FILE}: roles[${i}].role은 ${ROLES.join(", ")} 중 하나여야 합니다`);
    roles.push({ ...(annotation ? { annotation } : { suffix: suffix! }), role: r.role });
  }
  return roles.length ? { entries, roles } : { entries };
}

/** head 시점 저장소 루트의 설정 파일을 읽는다. 없으면 기본값 */
export async function loadConfig(head: FileSource): Promise<CallpathConfig> {
  const files = await head.listFiles();
  if (!files.includes(CONFIG_FILE)) return { entries: [] };
  return parseConfig(await head.read(CONFIG_FILE));
}
