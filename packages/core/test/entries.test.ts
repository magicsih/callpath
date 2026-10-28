import { describe, expect, it } from "vitest";
import { analyzeTrees } from "./helpers.js";
import { parseConfig } from "../src/config.js";

/** 진입점 하나와 그 진입점이 부르는 바뀐 메서드 하나로 흐름 라벨을 확인한다 */
async function labelFor(entryFile: string, entryPath: string): Promise<string[]> {
  const worker = (body: string) => `package p;\n\npublic class Worker {\n    public void work() {\n        ${body}\n    }\n}\n`;
  const session = await analyzeTrees(
    { [entryPath]: entryFile, "src/main/java/p/Worker.java": worker("a();") },
    { [entryPath]: entryFile, "src/main/java/p/Worker.java": worker("b();") },
  );
  return session.flows.map((f) => `${f.kind} ${f.label}`);
}

describe("진입점 감지와 라벨", () => {
  it("HTTP: 클래스 RequestMapping 경로와 메서드 경로를 잇는다", async () => {
    const src = `package p;\n\nimport org.springframework.web.bind.annotation.*;\n\n@RestController\n@RequestMapping(path = "/api/")\npublic class C {\n    private final Worker worker;\n    @GetMapping("/orders/{id}")\n    public String get() { worker.work(); return ""; }\n    @RequestMapping(value = "/x", method = RequestMethod.PUT)\n    public void put() { worker.work(); }\n}\n`;
    expect(await labelFor(src, "src/main/java/p/C.java")).toEqual(["http GET /api/orders/{id}", "http PUT /api/x"]);
  });

  it("Feign 인터페이스처럼 컨트롤러가 아닌 곳의 매핑은 진입점이 아니다", async () => {
    const src = `package p;\n\n@FeignClient("x")\npublic interface C {\n    @GetMapping("/a")\n    String get();\n}\n`;
    expect(await labelFor(src, "src/main/java/p/C.java")).toEqual([]);
  });

  it("Kafka, Scheduled, EventListener, main", async () => {
    const src = `package p;\n\npublic class C {\n    private final Worker worker;\n    @KafkaListener(topics = {"order.created", "order.paid"}, groupId = "g")\n    void on(String m) { worker.work(); }\n    @Scheduled(cron = "0 * * * * *")\n    void tick() { worker.work(); }\n    @EventListener\n    void paid(OrderPaid e) { worker.work(); }\n    public static void main(String[] args) { new Worker().work(); }\n}\n`;
    expect(await labelFor(src, "src/main/java/p/C.java")).toEqual([
      "message Kafka order.created, order.paid",
      "schedule Scheduled C.tick",
      "event Event OrderPaid",
      "main main C",
    ]);
  });

  it("gRPC: ImplBase를 상속한 클래스의 override 메서드", async () => {
    const src = `package p;\n\npublic class OrderGrpcService extends OrderServiceGrpc.OrderServiceImplBase {\n    private final Worker worker;\n    @Override\n    public void place(Req r, StreamObserver<Res> o) { worker.work(); }\n}\n`;
    expect(await labelFor(src, "src/main/java/p/OrderGrpcService.java")).toEqual(["grpc gRPC OrderService/place"]);
  });

  it("Kotlin: import 없이 package 바로 뒤의 클래스 애노테이션도 읽는다", async () => {
    const ctl = `package p\n\n@RestController\n@RequestMapping("/k")\nclass C(private val worker: Worker) {\n    @PostMapping("/run")\n    fun run() = worker.work()\n}\n`;
    const worker = (body: string) => `package p\n\nclass Worker {\n    fun work() {\n        ${body}\n    }\n}\n`;
    const session = await analyzeTrees(
      { "src/main/kotlin/p/C.kt": ctl, "src/main/kotlin/p/Worker.kt": worker("a()") },
      { "src/main/kotlin/p/C.kt": ctl, "src/main/kotlin/p/Worker.kt": worker("b()") },
    );
    expect(session.flows.map((f) => f.label)).toEqual(["POST /k/run"]);
  });

  it("설정 파일 규칙으로 사내 애노테이션을 진입점으로 더한다", async () => {
    const src = `package p;\n\npublic class C {\n    private final Worker worker;\n    @BusConsumer("orders")\n    void on(String m) { worker.work(); }\n}\n`;
    const worker = (body: string) => `package p;\n\npublic class Worker {\n    public void work() {\n        ${body}\n    }\n}\n`;
    const config = parseConfig("entries:\n  - annotation: '@BusConsumer'\n    kind: message\n    prefix: Bus\n");
    const session = await analyzeTrees(
      { "src/main/java/p/C.java": src, "src/main/java/p/Worker.java": worker("a();") },
      { "src/main/java/p/C.java": src, "src/main/java/p/Worker.java": worker("b();") },
      config,
    );
    expect(session.flows.map((f) => `${f.kind} ${f.label}`)).toEqual(["message Bus orders"]);
  });

  it("설정 파일의 잘못된 kind는 거부한다", () => {
    expect(() => parseConfig("entries:\n  - annotation: X\n    kind: cron\n")).toThrow(/kind/);
  });
});
