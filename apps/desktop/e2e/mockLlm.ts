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
  /** 답 전에 생각 과정(reasoning_content)을 잠시 보낸다(MiniMax 형식) */
  reasoning: boolean;
  close(): Promise<void>;
}

/** OpenAI 호환 끝점을 흉내 낸다. /v1/models와 스트리밍 /v1/chat/completions */
export async function startMockLlm(): Promise<MockLlm> {
  const mock = { requests: [], pieces: ["**재고 차감**이 ", "결제 승인 앞으로 ", "옮겨졌습니다.\n\n- 확인할 점: `approve` 실패 시 되돌림\n- **`decrease` 먼저** 호출"], rejectChat: false, reasoning: false } as unknown as MockLlm;
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
