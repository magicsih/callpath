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

function lookup(settings: Record<string, unknown>, section: string): unknown {
  let cur: unknown = settings;
  for (const key of section.split(".")) {
    if (cur === null || typeof cur !== "object" || !(key in cur)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
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
  private serviceReady = false;
  private readyWaiters: Array<() => void> = [];

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
    // 규약대로 요청한 섹션(예: "java", "java.project")의 값을 돌려준다. 섹션이 없으면 설정 전체
    conn.onRequest("workspace/configuration", (params: { items: Array<{ section?: string }> }) =>
      params.items.map((item) => (item.section ? lookup(opts.settings, item.section) : opts.settings)),
    );
    conn.onRequest("client/registerCapability", () => null);
    conn.onRequest("client/unregisterCapability", () => null);
    conn.onRequest("window/workDoneProgress/create", () => null);
    conn.onRequest("workspace/applyEdit", () => ({ applied: false }));
    conn.onRequest("window/showMessageRequest", () => null);
    // JDT LS는 프로젝트를 다 읽으면 language/status로 ServiceReady를 알린다
    conn.onNotification("language/status", (s: { type?: string }) => {
      if (s?.type === "ServiceReady") {
        client.serviceReady = true;
        for (const w of client.readyWaiters.splice(0)) w();
      }
    });
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

  /** JDT LS의 ServiceReady를 기다린다. 시간 안에 오지 않으면 false */
  waitForServiceReady(timeoutMs: number): Promise<boolean> {
    if (this.serviceReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      this.readyWaiters.push(() => {
        clearTimeout(t);
        resolve(true);
      });
    });
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

  private stopping: Promise<void> | null = null;

  /** 여러 곳(시간 초과, 정리)에서 불러도 한 번만 끄고, 끄는 중의 오류는 삼킨다 */
  stop(): Promise<void> {
    this.stopping ??= this.doStop().catch(() => undefined);
    return this.stopping;
  }

  private async doStop(): Promise<void> {
    if (!this.exited) {
      await withTimeout(this.conn.sendRequest("shutdown"), 10000, "shutdown").catch(() => undefined);
      try {
        this.conn.sendNotification("exit");
      } catch {
        // 이미 끊긴 연결
      }
    }
    this.conn.dispose();
    const proc = this.proc;
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      const t = setTimeout(() => (proc.kill("SIGKILL"), resolve()), 5000);
      proc.once("exit", () => (clearTimeout(t), resolve()));
    });
  }
}
