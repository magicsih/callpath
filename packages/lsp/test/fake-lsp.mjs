// 테스트용 가짜 LSP 서버. initialize에 답하고, 받은 workspace/configuration 응답을 파일에 적고,
// 호출 계층 질의에는 답하지 않는다(시간 초과 확인용). FAKE_LSP_LOG에 기록 파일 경로를 준다.
import { appendFileSync } from "node:fs";

const log = (o) => process.env.FAKE_LSP_LOG && appendFileSync(process.env.FAKE_LSP_LOG, JSON.stringify(o) + "\n");
let buf = Buffer.alloc(0);
let nextId = 1000;
const send = (msg) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
};
log({ started: process.pid });
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, sep).toString())?.[1]);
    if (buf.length < sep + 4 + len) return;
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString());
    buf = buf.subarray(sep + 4 + len);
    if (msg.method === "initialize") send({ id: msg.id, result: { capabilities: { callHierarchyProvider: true } } });
    else if (msg.method === "initialized") {
      send({ id: nextId++, method: "workspace/configuration", params: { items: [{ section: "java.project" }, {}] } });
      if (process.env.FAKE_LSP_READY_MS) setTimeout(() => send({ method: "language/status", params: { type: "ServiceReady", message: "ServiceReady" } }), Number(process.env.FAKE_LSP_READY_MS));
    }
    else if (msg.method === "shutdown") send({ id: msg.id, result: null });
    else if (msg.method === "exit") process.exit(0);
    else if (msg.id !== undefined && msg.method === undefined) log({ configurationResponse: msg.result });
    else if (msg.method) log({ request: msg.method });
    // textDocument/prepareCallHierarchy 등에는 답하지 않는다
  }
});
