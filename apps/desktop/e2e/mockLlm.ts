import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockLlm {
  /** 기준 주소(…/v1) */
  endpoint: string;
  /** 받은 요청. 대화 요청은 본문을 JSON으로 */
  requests: Array<{ method: string; url: string; auth: string | undefined; body: unknown }>;
  /** 대화 요청에 돌려줄 답 조각 */
  pieces: string[];
  /** 대화 요청을 401로 거절 */
  rejectChat: boolean;
  /** 답 전에 생각 과정(reasoning_content)을 잠시 보낸다 */
  reasoning: boolean;
  automaticDelay: number;
  automaticReply?: string;
  automaticActive: number;
  maxAutomaticActive: number;
  close(): Promise<void>;
}

/** OpenAI 호환 끝점을 흉내 낸다. /v1/models와 스트리밍 /v1/chat/completions */
export async function startMockLlm(): Promise<MockLlm> {
  const mock = { requests: [], pieces: ["**재고 차감**이 ", "결제 승인 앞으로 ", "옮겨졌습니다.\n\n- 확인할 점: `approve` 실패 시 되돌림\n- **`decrease` 먼저** 호출"], rejectChat: false, reasoning: false, automaticDelay: 0, automaticActive: 0, maxAutomaticActive: 0 } as unknown as MockLlm;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      mock.requests.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      }
      if (req.url === "/v1/chat/completions") {
        if (mock.rejectChat) {
          res.writeHead(401, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "bad key" } }));
        }
        const body = JSON.parse(raw) as { messages: Array<{ content: string }> };
        if (body.messages[0]?.content.includes("CALLPATH_CODE_NOTES_V2")) {
          const data = JSON.parse(body.messages[1]!.content) as { sources: Array<{ id: string; firstLine: number; text: string }>; steps: Array<{ n: number; label: string }> };
          const notes = data.steps.length ? data.steps.map(s => ({ step: s.n, text: `${s.label}에서 다음 작업을 호출해 이 흐름을 이어갑니다.` })) : data.sources.flatMap(s => {
            const lines = s.text.split("\n").map(l => { const m = /^(\d+): (.*)$/.exec(l)!; return { line: Number(m[1]), text: m[2]! }; });
            const classLine = lines.find(l => /\b(class|interface|record|object)\s/.test(l.text))?.line ?? s.firstLine;
            const meaningful = lines.filter(l => l.text.trim() && !/^\s*(import |package |[{}]+\s*$|\/\/|@)/.test(l.text) && !/\b(class|interface|record|object)\s/.test(l.text));
            const blocks = [];
            for (let i = 0; i < meaningful.length; i += 5) {
              const group = meaningful.slice(i, i + 5), code = group.map(l => l.text).join("\n");
              blocks.push({ source: s.id, line: group[0]!.line, endLine: group.at(-1)!.line, kind: "block", text: code.includes("decrease") ? "주문 항목의 재고를 차감합니다. 계산한 금액으로 이어지는 결제를 준비합니다." : code.includes("approve") ? "계산한 금액으로 결제 승인을 요청하고 결과를 다음 작업에 전달합니다." : code.includes("return") ? "처리 결과를 조합해 호출한 쪽으로 돌려줍니다." : "이 구간에서 필요한 입력과 참조값을 준비해 다음 작업에 전달합니다." });
            }
            return [{ source: s.id, line: classLine, endLine: classLine, kind: "class", text: "이 클래스는 주문 처리에 참여하며 필요한 값을 읽고 다음 작업을 호출합니다." }, ...blocks];
          });
          const reply = mock.automaticReply ?? notes.map(n => JSON.stringify(n)).join("\n") + "\n";
          mock.automaticActive++; mock.maxAutomaticActive = Math.max(mock.maxAutomaticActive, mock.automaticActive);
          res.writeHead(200, { "content-type": "text/event-stream" });
          try {
            for (const p of reply.match(/.{1,170}/gs) ?? []) {
              if (mock.automaticDelay) await new Promise(r => setTimeout(r, mock.automaticDelay));
              if (res.destroyed) break;
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
            }
            res.end("data: [DONE]\n\n");
          } finally { mock.automaticActive--; }
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (mock.reasoning)
          for (let i = 0; i < 5; i++) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "생각 중 " } }] })}\n\n`);
            await new Promise((r) => setTimeout(r, 300));
          }
        for (const p of mock.pieces) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
          await new Promise((r) => setTimeout(r, 150));
        }
        return res.end("data: [DONE]\n\n");
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  mock.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  mock.close = () =>
    new Promise((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
  return mock;
}
