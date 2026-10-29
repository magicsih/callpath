import { app } from "electron";
import { decryptSecret, encryptSecret, isWeakStorage } from "./secrets";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ghCliToken, ghCliUser, GitHubProvider, GitLabProvider, type KnownHosts, type Provider } from "@callpath/providers";
import type { ConnectionInput, ConnectionsState, ConnectionView } from "../shared/api";

interface Stored {
  id: string;
  kind: "github" | "gitlab";
  host: string;
  apiBase: string;
  auth: "gh-cli" | "token";
  /** safeStorage로 암호화한 토큰(base64) */
  token?: string;
  user: string | null;
}

const file = () => join(app.getPath("userData"), "connections.json");

function load(): Stored[] {
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8")) as Stored[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function persist(list: Stored[]): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  await rename(tmp, file());
}

const weak = isWeakStorage;

function view(s: Stored): ConnectionView {
  return { id: s.id, kind: s.kind, host: s.host, auth: s.auth, user: s.user, weakStorage: s.auth === "token" && weak() };
}

/** 호스트 입력을 정리한다. 주소 형태면 그 scheme과 포트를 지키고, 이름만 있으면 https로 본다 */
function normalize(kind: "github" | "gitlab", input: string): { host: string; apiBase: string } {
  const raw = input.trim().replace(/\/+$/, "");
  const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  const host = url.host.toLowerCase();
  if (kind === "github") return { host, apiBase: host === "github.com" ? "https://api.github.com" : `${url.origin}/api/v3` };
  return { host, apiBase: `${url.origin}/api/v4` };
}

function tokenSource(s: Stored): () => Promise<string | null> {
  if (s.auth === "gh-cli") return () => ghCliToken(s.host);
  return async () => {
    if (!s.token) return null;
    return decryptSecret(s.token);
  };
}

function providerOf(s: Stored): Provider {
  return s.kind === "github" ? new GitHubProvider(s.host, s.apiBase, tokenSource(s)) : new GitLabProvider(s.host, s.apiBase, tokenSource(s));
}

export async function listConnections(): Promise<ConnectionsState> {
  // 토큰을 읽을 수 있어야 쓸 수 있다. 계정 이름은 저장 전에 어떤 계정이 쓰이는지 보이려고 함께 읽는다
  const [token, user] = await Promise.all([ghCliToken("github.com"), ghCliUser("github.com")]);
  return { connections: load().map(view), ghCli: token !== null, ghCliUser: token !== null ? user : null, weakStorage: weak() };
}

const checks = new Map<string, AbortController>();

/** 기다리던 연결 확인을 멈춘다. 멈춘 확인은 저장하지 않는다 */
export function cancelConnectionCheck(requestId: string): void {
  checks.get(requestId)?.abort();
}

/** 연결을 확인한 뒤 저장한다. 같은 제공자와 호스트의 연결은 바꿔 끼운다 */
export async function saveConnection(input: ConnectionInput, requestId?: string): Promise<ConnectionView> {
  const { host, apiBase } = normalize(input.kind, input.kind === "github" && !input.host.trim() ? "github.com" : input.host);
  if (input.auth === "gh-cli" && (input.kind !== "github" || host !== "github.com")) throw new Error("gh CLI 계정은 GitHub.com에만 쓸 수 있습니다");
  let token: string | undefined;
  if (input.auth === "token") {
    if (!input.token?.trim()) throw new Error("토큰을 넣으세요");
    token = encryptSecret(input.token.trim());
  }
  const draft: Stored = { id: randomUUID(), kind: input.kind, host, apiBase, auth: input.auth, ...(token ? { token } : {}), user: null };
  const ctl = new AbortController();
  if (requestId) checks.set(requestId, ctl);
  try {
    draft.user = await providerOf(draft).whoami(ctl.signal);
  } finally {
    if (requestId) checks.delete(requestId);
  }
  const list = load().filter((s) => !(s.kind === draft.kind && s.host === draft.host));
  await persist([...list, draft]);
  return view(draft);
}

export async function deleteConnection(id: string): Promise<void> {
  await persist(load().filter((s) => s.id !== id));
}

export function knownHosts(): KnownHosts {
  const list = load();
  return { github: list.filter((s) => s.kind === "github").map((s) => s.host), gitlab: list.filter((s) => s.kind === "gitlab").map((s) => s.host) };
}

/** PR 주소의 호스트(포트 포함)로 연결을 찾는다 */
export function providerForHost(kind: "github" | "gitlab", host: string): Provider | null {
  const s = load().find((x) => x.kind === kind && x.host === host.toLowerCase());
  return s ? providerOf(s) : null;
}

/** 원격 주소에서 읽은 호스트 이름(포트 없음)으로 연결을 찾는다 */
export function connectionForHostname(hostname: string): { provider: Provider; host: string } | null {
  const s = load().find((x) => x.host.split(":")[0] === hostname.toLowerCase());
  return s ? { provider: providerOf(s), host: s.host } : null;
}
