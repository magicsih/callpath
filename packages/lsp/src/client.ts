import { spawn, type ChildProcess } from "node:child_process";
import * as p from "vscode-languageserver-protocol/node";
import type { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Position } from "vscode-languageserver-protocol";
import { pathToFileURL } from "node:url";

export interface ClientOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  rootDir: string;
  /** workspace/configuration과 initializationOptions.settings에 줄 설정 */
  settings: Record<string, unknown>;
  requestTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} 시간 초과(${Math.round(ms / 1000)}초)`)), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** 호출 계층 질의에 필요한 만큼만 구현한 LSP 클라이언트 */
export class LspClient {
  private exited: string | null = null;
  private stderrTail = "";

  private constructor(
    private readonly proc: ChildProcess,
    private readonly conn: p.ProtocolConnection,
    private readonly opts: ClientOptions,
  ) {}

  static async start(opts: ClientOptions): Promise<LspClient> {
    const proc = spawn(opts.command, opts.args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const conn = p.createProtocolConnection(new p.StreamMessageReader(proc.stdout!), new p.StreamMessageWriter(proc.stdin!));
    const client = new LspClient(proc, conn, opts);
    proc.stderr!.on("data", (d: Buffer) => (client.stderrTail = (client.stderrTail + d.toString()).slice(-2000)));
    const exited = new Promise<never>((_, reject) => {
      proc.on("error", (e) => reject(new Error(`${opts.name}를 실행하지 못했습니다: ${e.message}`)));
      proc.on("exit", (code) => {
        client.exited = `${opts.name}가 끝났습니다(종료 코드 ${code})`;
        reject(new Error(client.exited));
      });
    });
    exited.catch(() => undefined);
    conn.onRequest("workspace/configuration", (params: { items: unknown[] }) => params.items.map(() => opts.settings));
    conn.onRequest("client/registerCapability", () => null);
    conn.onRequest("client/unregisterCapability", () => null);
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.onRequest("workspace/applyEdit", () => ({ applied: false }));
    conn.onRequest("window/showMessageRequest", () => null);
    conn.listen();
    const root = pathToFileURL(opts.rootDir).href;
    await Promise.race([
      withTimeout(
        conn.sendRequest("initialize", {
          processId: process.pid,
          rootUri: root,
          workspaceFolders: [{ uri: root, name: "head" }],
          capabilities: {
            textDocument: { callHierarchy: { dynamicRegistration: false } },
            workspace: { configuration: true, workspaceFolders: true },
          },
          initializationOptions: { settings: opts.settings, extendedClientCapabilities: { classFileContentsSupport: false } },
        }),
        opts.requestTimeoutMs ?? 120000,
        `${opts.name} 시작`,
      ),
      exited,
    ]);
    conn.sendNotification("initialized", {});
    return client;
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    if (this.exited) return Promise.reject(new Error(this.exited));
    return withTimeout(this.conn.sendRequest(method, params) as Promise<T>, this.opts.requestTimeoutMs ?? 60000, `${this.opts.name} ${method}`);
  }

  open(path: string, languageId: string, text: string): void {
    this.conn.sendNotification("textDocument/didOpen", { textDocument: { uri: pathToFileURL(path).href, languageId, version: 1, text } });
  }

  prepare(path: string, position: Position): Promise<CallHierarchyItem[] | null> {
    return this.request("textDocument/prepareCallHierarchy", { textDocument: { uri: pathToFileURL(path).href }, position });
  }

  outgoing(item: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[] | null> {
    return this.request("callHierarchy/outgoingCalls", { item });
  }

  incoming(item: CallHierarchyItem): Promise<CallHierarchyIncomingCall[] | null> {
    return this.request("callHierarchy/incomingCalls", { item });
  }

  /** 서버가 남긴 마지막 표준 오류. 실패 원인을 알릴 때 쓴다 */
  get lastError(): string {
    return this.stderrTail.trim().split("\n").slice(-3).join(" ");
  }

  async stop(): Promise<void> {
    if (!this.exited) {
      await withTimeout(this.conn.sendRequest("shutdown"), 10000, "shutdown").catch(() => undefined);
      this.conn.sendNotification("exit");
    }
    this.conn.dispose();
    const proc = this.proc;
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve();
      const t = setTimeout(() => (proc.kill("SIGKILL"), resolve()), 5000);
      proc.once("exit", () => (clearTimeout(t), resolve()));
    });
  }
}
