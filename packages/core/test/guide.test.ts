import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { guide, isGeneratedPath, isLargeRepo, listGuideFiles, MAX_TOUR_DEPTH, MAX_TOUR_STEPS, suggestDirs, type GuideResult } from "../src/guide/guide.js";
import { displayName } from "../src/names.js";
import { DirectorySource, type FileSource } from "../src/source/fileSource.js";
import { writeTree, type Tree } from "./helpers.js";

const SHOP = resolve(__dirname, "../../../fixtures/shop");
const shop = () => guide(new DirectorySource(SHOP), { ref: "HEAD", sha: "" });

/** 파일 묶음을 임시 디렉터리에 쓰고 둘러본다 */
async function guideTree(files: Tree, dir?: string): Promise<GuideResult> {
  const root = mkdtempSync(join(tmpdir(), "callpath-guide-"));
  try {
    writeTree(root, files);
    return await guide(new DirectorySource(root), { ref: "HEAD", sha: "", ...(dir ? { dir } : {}) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function roleMap(r: GuideResult): Record<string, string> {
  return Object.fromEntries(r.guide.classes.map((c) => [c.name, c.role]));
}

describe("둘러보기 지도 (B1)", () => {
  it("패키지 행은 공통 앞부분을 뗀 이름이고, 테스트 클래스는 지도에 없다", async () => {
    const { guide: g } = await shop();
    expect(g.packages.map((p) => p.label)).toEqual(["shop", "config", "coupon", "notification", "order", "payment"]);
    expect(g.packages.find((p) => p.label === "order")!.files).toBe(10);
    expect(g.classes.some((c) => /Test$/.test(c.name) || c.path.includes("/test/"))).toBe(false);
  });

  it("클래스마다 역할을 애노테이션, 구조, 이름 끝 순서로 정한다", async () => {
    expect(roleMap(await shop())).toEqual({
      ShopApplication: "entry",
      ShopConfig: "config", ShopProperties: "config",
      CouponController: "entry", CouponCalculator: "service", CouponRepository: "data", Coupon: "model",
      OrderEventListener: "entry", UnpaidReminderJob: "entry", Notifier: "service", OrderPaid: "model",
      MailSender: "other", OrderEventPublisher: "other", "ReceiptText.kt": "other",
      OrderController: "entry", OrderService: "service", StockService: "service", OrderRepository: "data", StockRepository: "data",
      Order: "model", OrderItem: "model", OrderRequest: "model", OrderResult: "model", OrderStatus: "model",
      CardPaymentClient: "integration", PaymentClient: "integration", PointPaymentClient: "integration", PointLedger: "data",
      CardApproval: "model", PaymentResult: "model", PaymentAudit: "other",
    });
  });

  it("클래스 종류, 테스트 수, 진입점이 칩에 붙는다", async () => {
    const { guide: g } = await shop();
    const by = (name: string) => g.classes.find((c) => c.name === name)!;
    expect([by("OrderRequest").kind, by("OrderStatus").kind, by("OrderPaid").kind, by("MailSender").kind, by("ReceiptText.kt").kind])
      .toEqual(["record", "enum", "data", "interface", "file"]);
    expect(by("ReceiptText.kt").id).toBe("file:src/main/kotlin/com/example/shop/notification/ReceiptText.kt");
    expect(by("OrderService").tests).toBe(2);
    expect(by("ReceiptText.kt").tests).toBe(1);
    expect(by("OrderController").entryIds).toHaveLength(2);
    expect(by("Order").methods).toBe(7);
  });

  it("클래스 사이 연결 수와 신뢰도, 다른 패키지에서 부르는 수", async () => {
    const { guide: g } = await shop();
    const id = (name: string) => g.classes.find((c) => c.name === name)!.id;
    const link = (from: string, to: string) => g.links.find((l) => l.from === id(from) && l.to === id(to));
    expect(link("OrderController", "OrderService")).toMatchObject({ calls: 2, confidence: "medium" });
    expect(link("OrderService", "Order")).toMatchObject({ calls: 3 });
    // 인터페이스 호출을 구현 둘로 이은 것은 이름으로 고른 후보라 low다
    expect(link("OrderService", "CardPaymentClient")).toMatchObject({ calls: 1, confidence: "low" });
    expect(link("OrderService", "PaymentClient")).toBeUndefined();
    const fanIn = Object.fromEntries(g.classes.filter((c) => c.fanIn > 0).map((c) => [c.name, c.fanIn]));
    expect(fanIn).toEqual({ Order: 2, CouponCalculator: 1, OrderEventPublisher: 1, OrderRepository: 1, CardPaymentClient: 0.5, PointPaymentClient: 0.5 });
  });

  it(".callpath.yml roles가 기본 규칙보다 먼저다", async () => {
    const r = await guideTree({
      ".callpath.yml": "roles:\n  - annotation: '@UseCase'\n    role: service\n  - suffix: Port\n    role: integration\n",
      "src/main/java/p/PlaceOrder.java": "package p;\n\n@UseCase\npublic class PlaceOrder {\n}\n",
      "src/main/java/p/PaymentPort.java": "package p;\n\npublic interface PaymentPort {\n}\n",
      "src/main/java/p/OrderHandlerImpl.java": "package p;\n\npublic class OrderHandlerImpl {\n}\n",
    });
    expect(roleMap(r)).toEqual({ PlaceOrder: "service", PaymentPort: "integration", OrderHandlerImpl: "entry" });
    expect(() => parseConfig("roles:\n  - annotation: X\n    suffix: Y\n    role: data\n")).toThrow(/하나만/);
    expect(() => parseConfig("roles:\n  - suffix: Y\n    role: web\n")).toThrow(/role/);
  });
});

describe("투어 (B2)", () => {
  it("POST /orders: 호출 순서 깊이 우선, 사소한 메서드는 접고, 인터페이스는 구현 둘로 갈린다", async () => {
    const r = await shop();
    const entry = r.guide.entries.find((e) => e.label === "POST /orders")!;
    const t = r.tour(entry.id);
    expect(t.steps.map((s) => `${s.depth} ${displayName(s.symbol)}`)).toEqual([
      "0 OrderController.place",
      "1 OrderService.placeOrder",
      "2 CouponCalculator.validateCoupon",
      "3 CouponRepository.findByCode",
      "3 Coupon.discountFor",
      "2 StockService.decrease",
      "3 StockRepository.remaining",
      "3 StockRepository.update",
      "2 CardPaymentClient.approve",
      "3 PaymentAudit.record",
      "2 PointPaymentClient.approve",
      "3 PointLedger.deduct",
      "2 OrderEventPublisher.publishPlaced",
    ]);
    expect(t.truncated).toBe(false);
    expect(t.collapsed).toBe(9);
    const [, place, validate, findByCode, , , , , card, , point] = t.steps;
    expect(place!.folded.map((f) => f.name)).toEqual(["OrderRequest.totalAmount", "Order 생성자", "Order.getId", "Order.getAmount"]);
    // 한 줄 위임 find를 접고, 그 안의 findByCode는 validateCoupon의 find 호출 줄에서 이어진다
    expect(validate!.folded.map((f) => f.name)).toEqual(["CouponCalculator.find", "Coupon.isExpired"]);
    expect(findByCode!.parent).toBe(validate!.n);
    expect(findByCode!.line).toBe(validate!.folded[0]!.line);
    expect([card!.alternatives, point!.alternatives, card!.parent, card!.line]).toEqual([2, 2, place!.n, point!.line]);
    // 두 구현이 함께 부르는 record는 한 번만 단계가 되고, 두 번째는 앞 단계를 가리킨다
    expect(point!.calls.filter((c) => c.back)).toEqual([{ line: expect.any(Number), to: 10, back: true }]);
    expect(place!.calls.map((c) => c.to)).toEqual([3, 6, 9, 11, 13]);
    expect([card!.branch, place!.branch, place!.params]).toEqual(["implementations", null, ["OrderRequest"]]);
    expect(validate!.folded[0]!.classId).toBe("com.example.shop.coupon.CouponCalculator");
  });

  it("한 클래스의 같은 이름 메서드로 갈리면 오버로드다", async () => {
    const body = (s: string) => `        log(${s});\n        log(${s});\n`;
    const r = await guideTree({
      "src/main/java/p/Api.java": `package p;\n\n@RestController\npublic class Api {\n    @GetMapping("/a")\n    public void a(Object x) {\n        log(x);\n        help(x);\n    }\n    void help(int v) {\n${body("v")}    }\n    void help(String v) {\n${body("v")}    }\n    void log(Object o) {}\n}\n`,
    });
    const t = r.tour(r.guide.entries[0]!.id);
    expect(t.steps.slice(1).map((s) => [s.symbol.name, s.branch, s.params])).toEqual([["help", "overloads", ["int"]], ["help", "overloads", ["String"]]]);
  });

  it("Kotlin: 최상위 함수 파일과 식 본문을 접고, 접은 메서드를 지나 이어진다", async () => {
    const r = await shop();
    const steps = (label: string) => r.tour(r.guide.entries.find((e) => e.label === label)!.id).steps.map((s) => displayName(s.symbol));
    expect(steps("Kafka order-paid")).toEqual(["OrderEventListener.onPaid", "Notifier.sendReceipt", "MailSender.send"]);
    expect(steps("Scheduled UnpaidReminderJob.run")).toEqual(["UnpaidReminderJob.run", "OrderRepository.findUnpaidCustomerIds", "MailSender.send", "reminderText"]);
    expect(steps("GET /coupons/{code}")).toEqual(["CouponController.get", "CouponRepository.findByCode"]);
  });

  it(`깊이 ${MAX_TOUR_DEPTH}과 단계 ${MAX_TOUR_STEPS}에서 자르고 알린다`, async () => {
    const two = (i: number, next: string) => `    public void m${i}() {\n        log(${i});\n        ${next}\n    }\n`;
    const chain = Array.from({ length: 12 }, (_, i) => two(i, i < 11 ? `m${i + 1}();` : "")).join("\n");
    const wide = Array.from({ length: 70 }, (_, i) => `        w${i}();`).join("\n");
    // 잎 메서드도 두 문장이라 접히지 않는다
    const leaves = Array.from({ length: 70 }, (_, i) => two(100 + i, `log(${i});`).replace(`m${100 + i}`, `w${i}`)).join("\n");
    const r = await guideTree({
      "src/main/java/p/Deep.java": `package p;\n\n@RestController\npublic class Deep {\n    @GetMapping("/deep")\n    public void deep() {\n        log(0);\n        m0();\n    }\n${chain}\n    void log(int x) {}\n}\n`,
      "src/main/java/p/Wide.java": `package p;\n\n@RestController\npublic class Wide {\n    @GetMapping("/wide")\n    public void wide() {\n${wide}\n    }\n${leaves}\n    void log(int x) {}\n}\n`,
    });
    const deep = r.tour(r.guide.entries.find((e) => e.label === "GET /deep")!.id);
    expect(Math.max(...deep.steps.map((s) => s.depth))).toBe(MAX_TOUR_DEPTH);
    expect(deep.truncated).toBe(true);
    const wideTour = r.tour(r.guide.entries.find((e) => e.label === "GET /wide")!.id);
    expect(wideTour.steps).toHaveLength(MAX_TOUR_STEPS);
    expect(wideTour.truncated).toBe(true);
  });
});

describe("진입점 목록과 지연 계산 (B3)", () => {
  it("종류 순(HTTP, 메시지, 스케줄, main)이고 HTTP는 경로 다음 메서드 순이다", async () => {
    const { guide: g } = await shop();
    expect(g.entries.map((e) => `${e.kind} ${e.label}`)).toEqual([
      "http GET /coupons/{code}",
      "http POST /orders",
      "http GET /orders/{id}",
      "message Kafka order-paid",
      "schedule Scheduled UnpaidReminderJob.run",
      "main main ShopApplication",
    ]);
    expect(g.noEntries).toBe(false);
    expect(g.stats.entries).toBe(6);
  });

  it("투어는 결과에 들어 있지 않고 처음 열 때 만든 것을 다시 쓴다", async () => {
    const r = await shop();
    expect(JSON.stringify(r.guide)).not.toContain('"steps"');
    const id = r.guide.entries[1]!.id;
    expect(r.tour(id)).toBe(r.tour(id));
    expect(() => r.tour("없는 진입점")).toThrow(/찾을 수 없습니다/);
  });

  it("클래스를 지나는 진입점은 투어 단계로 찾는다", async () => {
    const r = await shop();
    const label = (ids: string[]) => ids.map((id) => r.guide.entries.find((e) => e.id === id)!.label);
    expect(label(r.entriesThrough("com.example.shop.payment.PaymentAudit"))).toEqual(["POST /orders"]);
    expect(label(r.entriesThrough("com.example.shop.notification.MailSender"))).toEqual(["Kafka order-paid", "Scheduled UnpaidReminderJob.run"]);
    // 접은 메서드(getter, 생성자, 한 줄 메서드)로만 닿는 클래스와, 구현 클래스가 단계로 나오는 인터페이스도 지난다
    expect(label(r.entriesThrough("com.example.shop.order.OrderRequest"))).toEqual(["POST /orders"]);
    expect(label(r.entriesThrough("com.example.shop.order.Order"))).toEqual(["POST /orders"]);
    expect(label(r.entriesThrough("com.example.shop.payment.PaymentClient"))).toEqual(["POST /orders"]);
    expect(r.entriesThrough("com.example.shop.config.ShopProperties")).toEqual([]);
  });

  it("구현 클래스는 저장소 안의 상위 타입을 안다", async () => {
    const { guide: g } = await shop();
    const by = (name: string) => g.classes.find((c) => c.name === name)!;
    expect(by("CardPaymentClient").supertypeIds).toEqual(["com.example.shop.payment.PaymentClient"]);
    expect(by("OrderRepository").supertypeIds).toEqual([]);
  });
});

describe("진입점이 없는 저장소 (B4)", () => {
  it("다른 패키지에서 많이 부르는 클래스의 공개 메서드로 투어를 대신한다", async () => {
    const r = await guideTree({
      "src/main/java/lib/text/TextUtils.java": `package lib.text;

public final class TextUtils {
    private TextUtils() {
    }

    public static String pad(String s, int width) {
        StringBuilder b = new StringBuilder(s);
        while (b.length() < width) {
            b.append(' ');
        }
        return b.toString();
    }

    public static String pad(String s) {
        String trimmed = s.trim();
        return pad(trimmed, 8);
    }

    public static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    public static String center(String s, int width) {
        int left = (width - s.length()) / 2;
        return pad(" ".repeat(left) + s, width);
    }
}
`,
      "src/main/java/lib/format/Table.java": `package lib.format;

import lib.text.TextUtils;

public class Table {
    public String row(String a, String b) {
        if (TextUtils.isBlank(a)) {
            return TextUtils.pad(b, 10);
        }
        String head = TextUtils.center(a, 10);
        return head + TextUtils.pad(b, 10) + TextUtils.pad(a);
    }
}
`,
    });
    expect(r.guide.noEntries).toBe(true);
    expect(r.guide.stats.entries).toBe(0);
    // 한 문장짜리 isBlank는 빼고, pad 오버로드는 가장 많이 불린 하나만 둔다
    expect(r.guide.entries.map((e) => `${e.kind} ${e.label}`)).toEqual(["api TextUtils.pad", "api TextUtils.center"]);
    const center = r.tour(r.guide.entries[1]!.id);
    expect(center.steps.map((s) => displayName(s.symbol))).toEqual(["TextUtils.center", "TextUtils.pad"]);
    // 칩에서 투어를 시작할 수 있게 진입점을 붙이지만, 역할은 구조대로 둔다
    const utils = r.guide.classes.find((c) => c.name === "TextUtils")!;
    expect(utils.entryIds).toEqual(r.guide.entries.map((e) => e.id));
    expect(utils.role).toBe("other");
  });

  it("Java 인터페이스의 default 메서드도 공개 API다", async () => {
    const r = await guideTree({
      "src/main/java/lib/core/Shape.java": `package lib.core;

public interface Shape {
    double area();

    default String describe() {
        String kind = getClass().getSimpleName();
        return kind + " " + area();
    }
}
`,
      "src/main/java/lib/core/Square.java": "package lib.core;\n\npublic class Square implements Shape {\n    public double area() {\n        return 4;\n    }\n}\n",
      "src/main/java/lib/print/Printer.java": "package lib.print;\n\nimport lib.core.Shape;\n\npublic class Printer {\n    public String print(Shape s) {\n        return s.describe();\n    }\n}\n",
    });
    expect(r.guide.entries.map((e) => e.label)).toEqual(["Shape.describe"]);
  });
});

describe("공개 API 진입점 이름", () => {
  it("다른 패키지의 같은 이름 중첩 클래스는 바깥 클래스 이름으로 구별한다", async () => {
    const ops = (pkg: string, outer: string) => `package ${pkg};\n\npublic class ${outer} {\n    public static class Ops {\n        public int apply(int v) {\n            int w = v + 1;\n            return w * 2;\n        }\n    }\n}\n`;
    const r = await guideTree({
      "src/main/java/lib/x/Fx.java": ops("lib.x", "Fx"),
      "src/main/java/lib/y/Fy.java": ops("lib.y", "Fy"),
      "src/main/java/lib/z/Use.java": "package lib.z;\n\npublic class Use {\n    public int run(lib.x.Fx.Ops a) {\n        int v = a.apply(1);\n        return v + 1;\n    }\n}\n",
    });
    expect(r.guide.noEntries).toBe(true);
    expect(r.guide.entries.map((e) => e.label).sort()).toEqual(["Fx.Ops.apply", "Fy.Ops.apply"]);
  });
});

describe("생성 코드와 큰 저장소 (B5)", () => {
  it("생성 코드 경로와 @Generated 클래스를 빼고 수를 알린다", async () => {
    const { guide: g } = await shop();
    expect(g.classes.map((c) => c.name)).not.toContain("QOrder");
    expect(g.classes.map((c) => c.name)).not.toContain("OrderMapperImpl");
    expect(g.stats.generated).toBe(2);
  });

  it.each([
    ["build/generated/source/kapt/main/A.java", true],
    ["module/target/classes/A.java", true],
    ["src/main/generated/A.java", true],
    ["app/build/tmp/A.kt", true],
    ["src/main/java/com/x/adapter/out/A.java", false],
    ["src/main/java/com/x/build/A.java", false],
    ["src/main/java/com/x/A.java", false],
  ])("생성 코드 경로 %s → %s", (path, expected) => {
    expect(isGeneratedPath(path)).toBe(expected);
  });

  it(`코드 파일이 3,000개를 넘으면 큰 저장소다`, async () => {
    const fake = (n: number): FileSource => ({
      label: "fake",
      listFiles: async () => [...Array.from({ length: n }, (_, i) => `src/main/java/p/C${i}.java`), "README.md", "build/generated/G.java"],
      read: async () => "",
      readMany: async () => new Map(),
    });
    const at = async (n: number) => isLargeRepo((await listGuideFiles(fake(n))).paths.length);
    expect(await at(3000)).toBe(false);
    expect(await at(3001)).toBe(true);
    expect((await listGuideFiles(fake(3))).generated).toBe(1);
  });

  it("좁힐 디렉터리 후보는 처음 갈라지는 곳의 하위 디렉터리다", () => {
    const single = ["src/main/java/com/x/order/A.java", "src/main/java/com/x/order/B.java", "src/main/java/com/x/pay/C.java"];
    expect(suggestDirs(single)).toEqual([{ path: "src/main/java/com/x/order", files: 2 }, { path: "src/main/java/com/x/pay", files: 1 }]);
    const modules = ["api/src/main/java/A.java", "core/src/main/java/B.java", "core/src/main/java/C.java", "Root.java"];
    expect(suggestDirs(modules)).toEqual([{ path: "core", files: 2 }, { path: "api", files: 1 }]);
  });

  it("디렉터리로 좁히면 그 아래 파일만 둘러본다", async () => {
    const r = await guide(new DirectorySource(SHOP), { ref: "HEAD", sha: "", dir: "src/main/kotlin" });
    expect(r.guide.classes.map((c) => c.name).sort()).toEqual(["MailSender", "Notifier", "OrderPaid", "ReceiptText.kt"]);
    expect(r.guide.dir).toBe("src/main/kotlin");
    expect(r.guide.noEntries).toBe(true);
  });
});
