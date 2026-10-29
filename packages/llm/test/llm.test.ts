import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyze, DirectorySource, type ReviewSession } from "@callpath/core";
import { apiUrl, explain, listModels, LlmError, MAX_CODE_CHARS, parseHeaders, preview, readEnvValue, ThinkFilter, type LlmConfig, type Snippet } from "../src/index.js";

const FIX = resolve(__dirname, "../../../fixtures/java");
let session: ReviewSession;

beforeAll(async () => {
  session = await analyze(new DirectorySource(join(FIX, "base")), new DirectorySource(join(FIX, "head")), { repo: FIX, baseLabel: "base", headLabel: "head" });
});

function snippetOf(path: string, side: "base" | "head", start: number, end: number): Snippet {
  const lines = readFileSync(join(FIX, side, path), "utf8").split("\n");
  return { path, side, startLine: start + 1, endLine: end + 1, text: lines.slice(start, end + 1).join("\n") };
}

describe("미리보기", () => {
  it("흐름 요약에는 호출 순서와 바뀐 메서드 코드가 들어가고, 전송 없이 만들어진다", () => {
    const flow = session.flows[0]!;
    const snippets = flow.steps.filter((s) => s.change !== "unchanged").map((s) => snippetOf(s.symbol.path, "head", s.symbol.range.startLine, s.symbol.range.endLine));
    const p = preview({ kind: "flow", flow, snippets });
    expect(p.title).toBe("POST /orders 흐름 요약");
    expect(p.graphSummary).toContain("순서가 바뀐 호출: approve");
    expect(p.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(p.messages[1]!.content).toContain("stockRepository.decrease");
    expect(p.scope.map((s) => s.path)).toEqual(snippets.map((s) => s.path));
    expect(p.omitted).toBe(0);
  });

  it("상한을 넘으면 흐름 뒤쪽 조각부터 빼고, 첫 조각 하나가 넘으면 앞부분 줄만 보낸다", () => {
    const flow = session.flows[0]!;
    const lines = (n: number, w: number) => Array.from({ length: n }, (_, i) => `line${i} ${"y".repeat(w)}`).join("\n");
    const huge: Snippet = { path: "Huge.java", side: "head", startLine: 10, endLine: 1009, text: lines(1000, 40) };
    const small: Snippet = { path: "Small.java", side: "head", startLine: 1, endLine: 3, text: "a\nb\nc" };
    const p = preview({ kind: "flow", flow, snippets: [huge, small] });
    expect(p.scope).toHaveLength(1);
    expect(p.scope[0]!.path).toBe("Huge.java");
    expect(p.scope[0]!.endLine).toBeLessThan(1009);
    expect(p.messages[1]!.content).toContain("이하");
    expect(p.omitted).toBe(1);
    // 작은 앞 조각 뒤에 큰 조각이 오면 큰 조각부터 뒤를 뺀다
    const q = preview({ kind: "flow", flow, snippets: [small, huge, small] });
    expect(q.scope.map((s) => s.path)).toEqual(["Small.java"]);
    expect(q.omitted).toBe(2);
    expect(q.omittedScope.map((s) => s.path)).toEqual(["Huge.java", "Small.java"]);
  });

  it("자른 조각도 생략 안내까지 넣어 상한을 넘지 않고, 한 줄이 너무 길면 글자로 자른다", () => {
    const flow = session.flows[0]!;
    const codeChars = (content: string) => (content.split("## 바뀐 메서드 코드")[1] ?? "").length;
    const many: Snippet = { path: "Many.java", side: "head", startLine: 1, endLine: 2000, text: Array.from({ length: 2000 }, (_, i) => `int v${i} = ${i};`).join("\n") };
    const p = preview({ kind: "flow", flow, snippets: [many] });
    expect(codeChars(p.messages[1]!.content)).toBeLessThanOrEqual(MAX_CODE_CHARS + 40);
    const oneLine: Snippet = { path: "Min.java", side: "head", startLine: 1, endLine: 1, text: "x".repeat(50000) };
    const q = preview({ kind: "flow", flow, snippets: [oneLine] });
    expect(codeChars(q.messages[1]!.content)).toBeLessThanOrEqual(MAX_CODE_CHARS + 40);
    expect(q.messages[1]!.content).toContain("이 줄의 뒷부분과 이하 생략");
  });

  it("같은 호출이 이어지면 묶고, 메서드 설명에도 시그니처 변경을 적는다", () => {
    const step = session.flows[0]!.steps.find((s) => s.symbol.name === "approve")!;
    const p = preview({ kind: "method", step, snippet: { path: step.symbol.path, side: "head", startLine: 1, endLine: 1, text: "x" }, baseSnippet: null, callers: [], callees: [] });
    expect(p.graphSummary).toContain("시그니처도 바뀜");
    const call = (name: string, line: number) => ({ name, arity: 1, receiver: "sb", depth: 0, control: null, nested: false, line });
    const many = { ...step, callOrderDiff: { base: [], head: Array.from({ length: 460 }, (_, i) => call("append", i)), moved: [], added: Array.from({ length: 460 }, (_, i) => i), removed: [], movedAcrossBlock: [], arityChanged: [] } };
    const q = preview({ kind: "method", step: many, snippet: { path: step.symbol.path, side: "head", startLine: 1, endLine: 1, text: "x" }, baseSnippet: null, callers: [], callees: [] });
    expect(q.graphSummary).toContain("append ×460");
    expect(q.graphSummary.match(/append/g)!.length).toBeLessThanOrEqual(2);
  });

  it("메서드 설명은 변경 후가 혼자 넘어도 변경 전 자리를 남기고, 생성자와 바뀌지 않은 메서드를 화면처럼 적는다", () => {
    const step = session.flows[0]!.steps.find((s) => s.symbol.name === "approve")!;
    const huge: Snippet = { path: step.symbol.path, side: "head", startLine: 1, endLine: 3000, text: Array.from({ length: 3000 }, (_, i) => `int v${i} = ${i};`).join("\n") };
    const base: Snippet = { path: step.symbol.path, side: "base", startLine: 1, endLine: 3, text: "void approve(long amount) {\n  gateway.charge(amount);\n}" };
    const p = preview({ kind: "method", step, snippet: huge, baseSnippet: base, callers: [], callees: [] });
    expect(p.scope.map((s) => s.side)).toEqual(["head", "base"]);
    expect(p.scope[0]!.truncatedFrom).toBe(3000);
    expect(p.omitted).toBe(0);
    expect(p.messages[1]!.content).toContain("gateway.charge(amount)");
    const ctor = session.orphans[0]!;
    const q = preview({ kind: "method", step: ctor, snippet: { path: ctor.symbol.path, side: "head", startLine: 1, endLine: 1, text: "x", unchanged: true }, baseSnippet: null, callers: [], callees: [], orphan: true });
    expect(q.graphSummary).toContain("메서드: OrderService 생성자 (shop.order.OrderService,");
    expect(q.messages[1]!.content).toContain("(바뀌지 않음)");
  });

  it("자른 조각은 원래 끝 줄을 남긴다", () => {
    const flow = session.flows[0]!;
    const many: Snippet = { path: "Many.java", side: "head", startLine: 1, endLine: 2000, text: Array.from({ length: 2000 }, (_, i) => `int v${i} = ${i};`).join("\n") };
    const p = preview({ kind: "flow", flow, snippets: [many] });
    expect(p.scope[0]!.truncatedFrom).toBe(2000);
    expect(p.scope[0]!.endLine).toBeLessThan(2000);
  });

  it("생성자는 화면과 같은 이름으로 적는다", () => {
    const step = session.orphans[0]!;
    const p = preview({ kind: "method", step, snippet: { path: step.symbol.path, side: "head", startLine: 1, endLine: 1, text: "x" }, baseSnippet: null, callers: [], callees: [], orphan: true });
    expect(p.title).toBe("OrderService 생성자 설명");
  });

  it("글자 상한을 넘는 조각은 빼고 몇 개 뺐는지 적는다", () => {
    const flow = session.flows[0]!;
    const big = (i: number): Snippet => ({ path: `Big${i}.java`, side: "head", startLine: 1, endLine: 2, text: "x".repeat(MAX_CODE_CHARS / 2) });
    const p = preview({ kind: "flow", flow, snippets: [big(1), big(2), big(3)] });
    expect(p.scope).toHaveLength(1);
    expect(p.omitted).toBe(2);
    expect(p.messages[1]!.content).toContain("코드 조각 2개를 뺐습니다");
  });

  it("메서드 설명에는 호출 경로, 부르는 쪽, 변경 전후 코드가 들어간다", () => {
    const step = session.flows[0]!.steps.find((s) => s.symbol.name === "placeOrder")!;
    const p = preview({
      kind: "method",
      step,
      snippet: snippetOf(step.symbol.path, "head", step.symbol.range.startLine, step.symbol.range.endLine),
      baseSnippet: snippetOf(step.baseSymbol!.path, "base", step.baseSymbol!.range.startLine, step.baseSymbol!.range.endLine),
      callers: step.path.slice(-2, -1),
      callees: ["validateCoupon", "decrease", "approve"],
    });
    expect(p.title).toBe("OrderService.placeOrder 설명");
    expect(p.graphSummary).toContain("호출 경로: OrderController.place → OrderService.placeOrder");
    expect(p.graphSummary).toContain("부르는 쪽: OrderController.place");
    expect(p.scope.map((s) => s.side)).toEqual(["head", "base"]);
  });

  it("진입점 미확정 단계는 호출 경로를 진입점이라고 적지 않는다", () => {
    const step = session.orphans[0]!;
    const p = preview({ kind: "method", step, snippet: { path: step.symbol.path, side: "head", startLine: 1, endLine: 1, text: "x" }, baseSnippet: null, callers: [], callees: [], orphan: true });
    expect(p.graphSummary).toContain("진입점 미확정");
    expect(p.graphSummary).not.toContain("이 메서드가 진입점");
  });
});

describe("추가 헤더", () => {
  it("이름: 값 줄을 읽고, 빈 줄은 건너뛰며, 틀린 줄과 authorization은 거부한다", () => {
    expect(parseHeaders("X-Gateway: abc:def\n\n  X-Team : core ")).toEqual({ "X-Gateway": "abc:def", "X-Team": "core" });
    expect(() => parseHeaders("no colon")).toThrow("1번째 줄");
    expect(() => parseHeaders("Bad Name: x")).toThrow("쓸 수 없는 글자");
    expect(() => parseHeaders("Authorization: Bearer x")).toThrow("API 키 칸");
  });
});

describe("키 파일", () => {
  it("export 줄과 따옴표, 주석을 정리해 값을 읽고, 없으면 null", () => {
    const text = "# 주석\nexport MINIMAX_API_KEY=sk-cp-abc\nOTHER=\"q v\" # 꼬리\nEMPTY=";
    expect(readEnvValue(text, "MINIMAX_API_KEY")).toBe("sk-cp-abc");
    expect(readEnvValue(text, "OTHER")).toBe("q v");
    expect(readEnvValue(text, "EMPTY")).toBeNull();
    expect(readEnvValue(text, "NONE")).toBeNull();
  });
});

describe("생각 과정 거르기", () => {
  it("조각 경계에서 갈린 <think> 태그도 걸러 내고 답 앞 빈 줄을 없앤다", () => {
    const f = new ThinkFilter();
    const parts = ["<thi", "nk>고민 중", "…</th", "ink>\n\n재고 차감이 ", "앞으로 <", "옮겨졌습니다"];
    let out = "";
    let thinking = 0;
    for (const p of parts) {
      const r = f.push(p);
      out += r.text;
      if (r.thinking) thinking++;
    }
    out += f.flush();
    expect(out).toBe("재고 차감이 앞으로 <옮겨졌습니다");
    expect(thinking).toBeGreaterThan(0);
  });
});

describe("주소", () => {
  it("기준 주소 뒤에 경로를 붙이고, 전체 주소를 받아도 같은 곳을 부른다", () => {
    expect(apiUrl("http://localhost:11434/v1/", "/chat/completions")).toBe("http://localhost:11434/v1/chat/completions");
    expect(apiUrl("https://g.example.com/v1/chat/completions", "/models")).toBe("https://g.example.com/v1/models");
  });
});

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let server: Server | null = null;
async function serve(handler: Handler): Promise<{ cfg: LlmConfig; seen: Array<{ url: string; headers: IncomingMessage["headers"]; body: string }> }> {
  const seen: Array<{ url: string; headers: IncomingMessage["headers"]; body: string }> = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { cfg: { endpoint: `http://127.0.0.1:${port}/v1`, model: "test-model", apiKey: "sk-secret-key-123", headers: { "x-gateway": "gw-secret-456" } }, seen };
}
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = null;
});

const payload = { messages: [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u 코드" }] };
const collect = async (it: AsyncIterable<string>) => {
  let out = "";
  for await (const p of it) out += p;
  return out;
};

describe("전송", () => {
  it("미리보기 내용을 그대로 보내고 스트리밍 조각을 이어 돌려준다", async () => {
    const { cfg, seen } = await serve((_req, _b, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const piece of ["재고 ", "차감이 ", "앞으로"]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    expect(await collect(explain(cfg, payload))).toBe("재고 차감이 앞으로");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/v1/chat/completions");
    expect(JSON.parse(seen[0]!.body)).toEqual({ model: "test-model", messages: payload.messages, stream: true });
    expect(seen[0]!.headers.authorization).toBe("Bearer sk-secret-key-123");
    expect(seen[0]!.headers["x-gateway"]).toBe("gw-secret-456");
  });

  it("reasoning_content로 오는 생각 과정은 답에 넣지 않고 생각 중이라고 알린다(MiniMax 형식)", async () => {
    const { cfg } = await serve((_req, _b, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", reasoning_content: "사용자가 묻는 것은…" } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "답" } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    let thought = 0;
    let out = "";
    for await (const p of explain(cfg, payload, undefined, { onThinking: () => thought++ })) out += p;
    expect(out).toBe("답");
    expect(thought).toBe(1);
  });

  it("스트리밍하지 않는 끝점의 한 번에 온 답도 받는다", async () => {
    const { cfg } = await serve((_req, _b, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "한 번에 온 답" } }] }));
    });
    expect(await collect(explain(cfg, payload))).toBe("한 번에 온 답");
  });

  it("키 거부는 auth이고 오류 문구에 키와 헤더 값이 없다", async () => {
    const { cfg } = await serve((_req, _b, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid key sk-secret-key-123 gw-secret-456" } }));
    });
    const err = (await collect(explain(cfg, payload)).catch((e: unknown) => e)) as LlmError;
    expect(err.code).toBe("auth");
    expect(err.message).toContain("키가 거부되었습니다");
    expect(err.message).not.toContain("sk-secret-key-123");
    expect(err.message).not.toContain("gw-secret-456");
  });

  it("멈추면 cancelled, 조각이 오지 않으면 timeout으로 끝난다", async () => {
    const { cfg } = await serve((_req, _b, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "첫 조각" } }] })}\n\n`);
      // 이후 아무것도 보내지 않는다
    });
    const ctl = new AbortController();
    const got: string[] = [];
    const run = (async () => {
      for await (const p of explain(cfg, payload, ctl.signal)) {
        got.push(p);
        ctl.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
    expect(got).toEqual(["첫 조각"]);
    await expect(collect(explain(cfg, payload, undefined, { idleMs: 300 }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("모델 목록으로 코드 없이 주소와 키를 확인한다", async () => {
    const { cfg, seen } = await serve((req, _b, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "test-model" }, { id: "other" }] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    expect(await listModels(cfg)).toEqual(["test-model", "other"]);
    expect(seen[0]!.body).toBe("");
    const bad = (await listModels({ ...cfg, endpoint: cfg.endpoint.replace("/v1", "/nope") }).catch((e: unknown) => e)) as LlmError;
    expect(bad.code).toBe("not-found");
  });
});
