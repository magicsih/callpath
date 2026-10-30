# 7단계 설계: 새 저장소 안내자

- 상태: 승인 (2026-10-30). 지도는 패키지 × 역할 격자로 확정
- 상위 설계: [2026-10-28-flow-review](../2026-10-28-flow-review/README.md)의 1.2절 요구 4, 2.3절 시나리오 C, 10절 7단계("별도 설계 보강 뒤 진행")
- 테스트 계획: [test-plan.md](test-plan.md)

## 1. 목적과 범위

### 1.1 문제

처음 보는 저장소를 열면 파일 트리가 경로 순서로 보인다. 어디가 입구이고, 요청이 어떤 클래스를 거쳐 어디서 끝나는지, 어떤 패키지가 중심인지는 직접 따라가 봐야 안다. 1차 기능은 base와 head를 비교해 "바뀐 것"을 흐름 순서로 읽게 했다. 7단계는 비교 없이 **한 커밋의 저장소 전체**를 같은 방식으로 읽게 한다.

### 1.2 목표

사용자가 고른 대로 두 가지를 같은 비중으로 둔다.

| 보기 | 답하는 질문 |
|---|---|
| 지도 | 이 저장소는 어떤 패키지와 역할(진입, 서비스, 데이터 등)로 나뉘고, 무엇이 무엇을 부르는가 |
| 투어 | 진입점 하나를 골랐을 때 어떤 순서로 코드를 읽으면 되는가 |

지도에서 투어로, 투어에서 지도로 한 번에 오간다.

### 1.3 범위와 비범위

- 범위: Java, Kotlin. 로컬 저장소의 한 커밋(기본은 지금 브랜치의 HEAD). 1차의 분석 코어(색인, 1계층 호출 그래프, 진입점 감지), 코드 보기, 호출 스택, LLM 설명을 다시 쓴다.
- 비범위
  - 커밋하지 않은 작업 트리 변경(D20)
  - 외부 라이브러리 내부와 빌드 도구의 모듈 정의 해석. Gradle, Maven 멀티 모듈은 디렉터리와 패키지 이름으로만 나눈다
  - 저장소 전체 정밀 분석(LSP). 처음 화면은 1계층 결과로만 그리고, 신뢰도가 낮은 연결은 그렇게 표시한다
  - PR 주소로 둘러보기. 필요하면 PR을 연 뒤 head 커밋으로 둘러보기를 여는 길만 둔다

### 1.4 성공 기준

- 새 표본 `fixtures/shop`(2절 검증용)에서 지도가 루트와 기능 패키지 5개를 역할 열에 맞게 놓고, 투어가 `POST /orders`에서 시작해 `OrderController → OrderService → …` 순서로 이어진다
- spring-petclinic(파일 50개, 진입점 18개)에서 HTTP 진입점 투어가 열린다
- commons-lang(테스트를 뺀 파일 264개, 메서드 4,543개, 진입점 0개)에서 "진입점이 없는 저장소"로 알리고 공개 API 투어로 대신한다

## 2. 사용자 흐름

1. 시작 화면에서 저장소를 연다. 비교 선택 화면에 "비교" 옆으로 **"둘러보기"** 를 둔다. 기본은 지금 브랜치이고, 다른 브랜치나 태그를 고를 수 있다.
2. 둘러보기 화면이 열리면 분석 중에는 단계별 진행(파일 읽기, 호출 잇기, 지도 만들기)과 파일 수를 보인다.
3. 왼쪽 위의 **[지도 | 투어]** 전환으로 두 보기를 오간다. 마지막에 본 보기와 위치를 저장소별로 기억한다.
4. 지도에서 칸(패키지 × 역할)이나 클래스를 고르면 가운데에 코드, 오른쪽에 그 클래스가 부르는 것과 부르는 쪽, 그 클래스에서 시작하는 진입점이 보인다. "여기서 투어 시작"으로 투어로 넘어간다.
5. 투어에서 진입점을 고르면 단계 목록이 생긴다. `j`/`k`로 단계 이동, `Enter`로 다음 단계, `Backspace`로 되돌아가기. 1차 리뷰 화면과 같은 키다. 오른쪽에 호출 스택, 단계마다 "지도에서 보기".
6. LLM 설명이 켜져 있으면 "이 클래스 설명", "이 패키지 설명"을 둔다. 1차와 같이 보낼 내용을 먼저 보이고 "보내기"를 눌러야 보낸다(D15).

## 3. 화면

### 3.1 둘러보기 화면: 지도

```
┌ 상단: Callpath  shop  main@3c268e3  파일 42 · 클래스 31 · 진입점 6     [다시 분석] [비교로] ┐
├ [지도] 투어 ─────────┬ 지도: 패키지 × 역할 ────────────────────────────────┬ 맥락 ──────────────┤
│ 패키지 5             │          진입      서비스    외부연동   데이터  모델 │ OrderService        │
│ ▸ order        14    │ order   [Order    [Order               [Order  [Ord │ 역할: 서비스         │
│ ▸ coupon        5    │          Contr.]   Service]             Repo.]  er] │ 부르는 쪽 2          │
│ ▸ payment       4    │ coupon             [Coupon                     [Cou │  OrderController…   │
│ ▸ notification  6    │                     Calc.]                      pon]│ 부르는 것 4          │
│ ▸ config        2    │ payment                      [Payment              │  CouponCalculator…  │
│                      │                               Client]              │ 이 클래스를 지나는   │
│ 많이 쓰이는 클래스    │ notif.  [Order                                     │ 진입점 2             │
│  OrderService   9    │          Listener]                                  │  POST /orders ▶     │
│  Money          7    │ ── 선택한 클래스의 연결을 선으로 보인다 ──           │ [여기서 투어 시작]   │
└──────────────────────┴─────────────────────────────────────────────────────┴────────────────────┘
```

- 가운데 지도는 행이 패키지, 열이 역할인 격자다(D17). 칸 안에 클래스 이름을 칩으로 놓고, 칩을 고르면 그 클래스가 부르는 칩과 부르는 쪽 칩을 선으로 잇는다. 모든 선을 한꺼번에 그리지 않는다.
- 클래스 칩을 두 번 누르거나 `Enter`를 누르면 가운데가 코드 보기로 바뀌고, 위에 "지도로" 돌아가는 길이 생긴다.
- 왼쪽에는 패키지 목록과 "많이 쓰이는 클래스"(다른 패키지에서 부르는 수)를 둔다.
- 좁은 창에서는 1차와 같이 오른쪽 영역을 접고 맥락을 지도 아래로 내린다.

### 3.2 둘러보기 화면: 투어

```
┌ 상단 (같음) ──────────────────────────────────────────────────────────────────────────────────┐
├ 지도 [투어] ─────────┬ 코드: OrderService.placeOrder ────────────────────────┬ 호출 스택 ──────────┤
│ 진입점 6              │  public OrderResult placeOrder(OrderRequest r) {     │ OrderController     │
│ ▾ POST /orders   7    │    long amount = r.totalAmount();                   │  .place             │
│   1 place             │    long discount = coupons.validateCoupon(r);  ←2  │ ▸ OrderService      │
│   2 placeOrder  ●     │    stock.decrease(r.items());                  ←3  │    .placeOrder      │
│   3 validateCoupon    │    payment.approve(...);                       ←4  │ 이어지는 단계        │
│   4 decrease          │    return repo.confirm(r, amount - discount);  ←5  │  3 validateCoupon ⏎ │
│   5 approve           │  }                                                  │ [지도에서 보기]      │
│   … 접힌 단계 2        │                                                     │ LLM 설명            │
│ ▸ GET /orders/{id} 3  │                                                     │ [이 클래스 설명]     │
│ ▸ Kafka order-paid 4  │                                                     │                     │
└───────────────────────┴─────────────────────────────────────────────────────┴─────────────────────┘
          [← 이전]  POST /orders · 2 / 7  [다음 →]     j/k 이동 · Enter 다음 단계 · ⌫ 되돌아가기
```

- 단계는 진입점에서 호출 순서대로 이어지는 저장소 안 메서드다(D18). 코드에는 다음 단계로 이어지는 호출 줄 옆에 단계 번호를 붙인다.
- getter, setter, 한 줄 위임 같은 사소한 메서드는 단계로 세지 않고 "접힌 단계"로 묶는다.
- 1차 리뷰 화면과 달리 diff가 아니라 한 열 코드 보기다.

### 3.3 화면별 기록

| 화면 | 목적 | 가장 강조하는 행동 | 필수 정보 | 상태 |
|---|---|---|---|---|
| 둘러보기 시작(비교 선택 화면 안) | 어느 커밋을 둘러볼지 고른다 | 둘러보기 | 브랜치나 태그, 커밋 | 기본은 지금 브랜치 |
| 지도 | 저장소의 패키지와 역할, 연결을 본다 | 클래스 고르기, 여기서 투어 시작 | 패키지 × 역할 격자, 많이 쓰이는 클래스, 고른 클래스의 연결과 진입점 | 분석 중(단계와 파일 수), 완료, 진입점 없음, 큰 저장소 경고, 실패 |
| 투어 | 진입점부터 읽을 순서를 따라간다 | 다음 단계 | 진입점 목록, 단계, 코드와 단계 번호, 호출 스택 | 진입점 없음이면 공개 API 투어, 접힌 단계, 끝 단계 |

## 4. 구조

### 4.1 코어에 더할 것

`packages/core`에 Electron과 무관한 `guide(source, opts)`를 더한다(`packages/core/src/guide/`). 1차의 `indexSource`, `buildCallGraph`, `detectEntries`, 테스트 판정을 그대로 쓴다.

```ts
interface GuideResult {
  guide: RepoGuide;                         // 직렬화해 화면과 캐시로 보내는 부분
  tour(entryId: string): Tour;              // 처음 부를 때 만들고 기억한다
  entriesThrough(classId: string): string[]; // 투어 단계에 이 클래스가 나오는 진입점
}
interface RepoGuide {
  ref: string; sha: string; dir: string | null;
  stats: { files: number; generated: number; classes: number; methods: number; edges: number; entries: number; ms: number };
  packages: PackageNode[];        // 지도의 행
  classes: ClassNode[];           // 지도의 칩
  links: ClassLink[];             // 클래스 사이 호출 수(패키지 밖 연결 포함)
  entries: TourEntry[];           // 투어 목록. 진입점이 없으면 공개 API 진입점
  noEntries: boolean;
}
interface ClassNode { id: string; name: string; packageName: string; path: string; kind: ClassKind | "file"; role: Role; range: Range; methods: number; fanIn: number; tests: number; entryIds: string[] }
type Role = "entry" | "service" | "integration" | "data" | "model" | "config" | "other";
interface Tour { entry: TourEntry; steps: TourStep[]; collapsed: number; truncated: boolean }
interface TourStep {
  n: number; symbol: SymbolRef; classId: string; depth: number;
  parent: number | null; line: number | null;   // 부른 단계와 그 본문의 호출 줄
  alternatives: number;                          // 2 이상이면 인터페이스 구현 같은 갈래
  calls: { line: number; to: number; back: boolean }[]; // 코드 옆 단계 번호. back이면 앞 단계를 다시 부름
  folded: { line: number; name: string }[];      // 접은 사소한 메서드
}
```

- 색인기는 이를 위해 클래스 종류(`kind`: class, interface, enum, record, data, object, annotation)와 메서드 본문의 문장 수(`statements`)를 더 기록한다.
- 투어 단계는 진입점마다 처음 열 때 만든다(지연 계산). 진입점이 수백 개인 저장소에서 처음 화면을 빨리 띄우기 위해서다.
- CLI에 `callpath guide <repo> [--ref HEAD] [--dir <경로>] [--summary] [--tour <n|all>]`를 더해 표본과 실제 저장소로 시험한다. git 저장소가 아니면 디렉터리를 그대로 읽는다.

### 4.2 데스크톱

- 분석은 1차와 같은 워커에서 돈다. 진행 소식(파일 읽기 n/N, 호출 잇기, 지도 만들기)을 0.1초에 한 번까지 보낸다.
- 지도(`RepoGuide`)는 1차 세션 캐시(`cache.db`)의 `guides` 표에 커밋 SHA, 좁힌 디렉터리, 분석기 버전을 키로 저장한다(저장소마다 최근 10개). 같은 커밋을 다시 열면 바로 그린다.
- 투어와 "이 클래스를 지나는 진입점"은 호출 그래프가 있어야 답할 수 있어, 워커가 최근 둘러본 2개의 `GuideResult`를 메모리에 둔다. 캐시로 지도를 그린 경우에는 뒤에서 호출 그래프를 다시 만들어 투어를 물을 때 바로 답한다.
- 큰 저장소 판정과 좁힐 디렉터리 후보(`suggestDirs`: 한 디렉터리로만 이어지는 동안 내려가다 처음 갈라지는 곳의 하위 디렉터리)는 분석 전에 파일 목록만으로 한다.
- 화면은 1차 구성 요소의 모양과 키를 따른다: 호출 스택, 읽기 전용 Monaco 코드 보기, j/k와 Enter와 Backspace. 투어 코드 보기는 단계 메서드만 잘라 보이고, 호출 줄 끝에 이어지는 단계(→), 앞 단계를 다시 부름(↩), 접은 메서드를 붙인다.
- 비교 선택 화면에 "저장소 둘러보기"를 둔다. 브랜치가 하나뿐인 저장소는 비교할 것이 없어 둘러보기를 주 버튼으로 두고 초점을 준다.
- 지도는 가로 폭이 필요해 창이 1100px 이하면 맥락을 지도 아래로 내리고, 클래스를 골랐을 때만 보인다. 투어는 리뷰 화면처럼 820px 이하에서 내린다.
- 마지막으로 둘러본 자리(보기, 고른 클래스, 진입점, 단계)는 저장소별로 `state.json`의 `guides`에 두고, 앱을 다시 열면 둘러보기로 돌아온다.

## 5. 핵심 규칙

### 5.1 역할 나누기 (지도의 열)

칩은 최상위 클래스 단위다. 중첩 클래스와 companion object는 바깥 클래스에 합친다. 역할은 `.callpath.yml`의 사용자 규칙, 애노테이션(진입점 메서드 포함), 구조(record, data class, enum), 이름 끝과 상위 타입 순서로 보고, 각 단계에서 표의 위에서부터 먼저 맞는 것 하나만 쓴다. 이름 끝을 볼 때는 `Impl`을 뗀다(`PaymentClientImpl` → 외부 연동). 그래서 `@ConfigurationProperties`가 붙은 record는 설정이다.

| 역할 | 애노테이션 | 이름 끝, 상위 타입 |
|---|---|---|
| 진입 | `@RestController`, `@Controller`, 진입점 메서드가 있는 클래스(메시지 리스너, `@Scheduled`, gRPC 구현, `main`) | `Controller`, `Listener`, `Consumer`, `Handler`, `Job` |
| 서비스 | `@Service` | `Service`, `UseCase`, `Facade` |
| 외부 연동 | `@FeignClient`, `@HttpExchange` | `Client`, `Gateway`, `Adapter` |
| 데이터 | `@Repository`, `@Mapper` | `Repository`, `Dao`, `Mapper`, 상위 타입 `JpaRepository`, `CrudRepository` |
| 모델 | `@Entity`, `@Embeddable`, `@Document`, Java record, Kotlin data class, enum | `Dto`, `Request`, `Response`, `Vo`, `Event` |
| 설정 | `@Configuration`, `@ConfigurationProperties` | `Config`, `Configuration`, `Properties` |
| 기타 | 위에 없음 | |

규칙은 1차 진입점 규칙처럼 `.callpath.yml`의 `roles`로 더한다(`- annotation: '@UseCase'` 또는 `- suffix: Port`와 `role: service`). 테스트 클래스는 지도와 투어에 넣지 않고, 클래스의 맥락에 "이 클래스를 부르는 테스트 n개"로만 보인다.

### 5.2 투어 순서 (D18)

1. 진입점 목록은 종류 순(HTTP, 메시지, 스케줄, 이벤트, gRPC, main), 같은 종류 안에서는 이름 순이다. HTTP는 같은 경로의 GET, POST가 붙어 나오게 경로 다음에 메서드 순이다.
2. 진입점 메서드에서 호출문이 본문에 나오는 순서대로 깊이 우선으로 따라간다. 1차 흐름 정렬과 같다.
3. 저장소 안 메서드만 단계가 된다. 같은 투어에서 이미 나온 메서드는 다시 세지 않고 "앞 단계 n"으로 가리킨다.
4. 사소한 메서드는 단계로 세지 않고 접는다. 본문의 문장 수(반복문, 조건문, 람다 안의 블록 포함)가 1 이하인 메서드(getter, setter, 한 줄 위임, Kotlin 식 본문)와 저장소 안 호출이 없는 생성자다. 접은 메서드가 저장소 안 메서드를 부르면 그 호출은 접은 메서드를 부른 단계의 같은 줄에서 이어진다(한 줄 위임 `find` → `findByCode`). 본문이 없는 추상 메서드는 구현이 없을 때 데이터 접근이나 외부 경계를 보여 주므로 단계로 둔다.
5. 깊이 8, 단계 60에서 자르고 "잘린 가지가 있음"을 알린다.
6. 인터페이스를 부르면 1계층이 찾은 구현 클래스로 이어 가고, 구현이 여럿이면 갈래로 보인다.

### 5.3 진입점이 없는 저장소 (D19)

라이브러리처럼 진입점 규칙에 맞는 메서드가 없으면 그 사실을 알리고 **공개 API 투어**로 대신한다. 다른 패키지에서 많이 부르는 공개 클래스(많이 쓰이는 클래스 순) 상위 20개에서, 다른 패키지가 많이 부르는 공개 메서드를 클래스마다 3개까지 진입점처럼 쓴다. 투어가 한 단계로 끝나는 사소한 메서드와 생성자는 빼고, 오버로드는 가장 많이 불린 하나만 둔다. commons-lang에서 이 경우를 확인했다(진입점 36개).

### 5.4 많이 쓰이는 클래스

클래스마다 다른 패키지의 메서드가 그 클래스 메서드를 부르는 간선 수(fan-in)를 센다. 이름만으로 이은 간선(신뢰도 low)은 절반으로 센다. 자기 패키지 안의 호출은 세지 않는다.

## 6. 성능과 큰 저장소

- 측정(2026-10-30, M 시리즈 맥, 1계층만)
  - 1차 `analyze`로 잰 설계 때 값: spring-petclinic 파일 50개 0.2초, commons-lang 파일 630개(테스트 포함, 메서드 1만 1천 개, 간선 10만 개) 6.2초
  - 7a `guide()`: spring-petclinic 0.1초, commons-lang 2.3초. 모든 진입점의 투어를 만드는 데 각각 1ms, 7ms. 화면으로 보낼 결과 JSON은 27KB, 240KB
- 목표: 파일 1,000개 이하는 처음 분석 10초 안, 같은 커밋 다시 열기 1초 안. 분석 중에도 화면은 움직이고 진행을 보인다.
- 파일이 3,000개를 넘으면 시작 전에 알리고, 디렉터리 하나로 좁혀 둘러보기를 고를 수 있게 한다.
- `build/`, `target/`, `out/`, `generated` 경로와 `@Generated` 클래스는 넣지 않는다.

## 7. LLM 설명

- "이 클래스 설명", "이 패키지 설명"을 둔다. 1차 설명 대화상자, 키 파일, 기록, 생각 과정 처리를 그대로 쓴다.
- 보내는 범위: 클래스 설명은 그 클래스 코드(글자 상한 안), 역할, 부르는 쪽과 부르는 것의 이름. 패키지 설명은 패키지의 클래스 이름, 역할, 공개 메서드 시그니처, 다른 패키지와의 연결 수. 패키지 설명에는 메서드 본문을 보내지 않는다.
- 미리보기 없이 보내는 길은 없다(D15). 받은 답은 같은 커밋 동안 기억한다.

## 8. 실패와 한계

| 상황 | 동작 |
|---|---|
| 진입점 없음 | 알리고 공개 API 투어(5.3) |
| 파일 3,000개 초과 | 시작 전 경고와 디렉터리로 좁히기 |
| 역할을 못 정함 | "기타" 열. 클래스 맥락에 "역할 규칙에 맞지 않음"과 `.callpath.yml` 안내 |
| 이름으로만 이은 연결 | 선을 점선으로 그리고 "이름으로 이음" 표시 |
| Kotlin 최상위 함수 | 파일 이름을 클래스처럼 칩으로 보인다 |
| 분석 실패 | 1차와 같은 실패 화면과 다시 시도 |

## 9. 결정 (결정 기록 D17~D20)

| 번호 | 결정 | 대안과 버린 이유 |
|---|---|---|
| D17 | 지도는 패키지(행) × 역할(열) 격자. 선은 고른 클래스의 연결만 그린다 | 일반 그래프 배치(dagre, ELK): 클래스가 수백 개면 선이 엉켜 읽을 수 없고 의존이 늘어난다. 패키지 트리만: 역할과 연결이 안 보인다 |
| D18 | 투어는 1차 흐름 정렬 규칙(호출 순서 깊이 우선)을 저장소 전체 메서드로 넓히고, 사소한 메서드는 접는다 | 클래스 단위 투어: 같은 클래스 안에서 오가는 순서가 사라진다 |
| D19 | 진입점이 없으면 많이 쓰이는 공개 클래스로 공개 API 투어 | 파일 경로 순 안내: 지금 파일 트리와 다르지 않다 |
| D20 | 둘러보기는 커밋 단위. 작업 트리 변경은 넣지 않는다 | 작업 트리 포함: 캐시 키를 정할 수 없고, 1차 비교와 겹친다 |

## 10. 구현 단계

| 단계 | 내용 | 끝나는 조건 |
|---|---|---|
| 7a | 코어 `guide()`, 역할 규칙, 투어, 공개 API 투어, CLI, 표본 `fixtures/shop` | 인수조건 B1~B5 단위 시험 통과, petclinic과 commons-lang 측정 기록 |
| 7b | 둘러보기 화면(지도, 투어, 오가기, 기억), 캐시, 진행 | B6~B10 E2E 통과, 새 화면 독립 검수 3회 |
| 7c | 클래스와 패키지 LLM 설명 | B11 E2E 통과 |
