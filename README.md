# Callpath

AI가 한 번에 고쳐 올린 PR을 파일 순서가 아니라 호출 흐름 순서로 읽는 데스크톱 리뷰 앱. 진입점부터 변경 메서드를 따라가고, 메서드 안의 호출 순서가 바뀐 곳을 표시하고, 테스트 코드는 토글로 분리해 본다. Java, Kotlin이 1차 대상이다.

- 설계: [docs/design/2026-10-28-flow-review/README.md](docs/design/2026-10-28-flow-review/README.md)
- 테스트 계획: [docs/design/2026-10-28-flow-review/test-plan.md](docs/design/2026-10-28-flow-review/test-plan.md)
- 결정 기록: [docs/design/2026-10-28-flow-review/decisions.md](docs/design/2026-10-28-flow-review/decisions.md)

## 구성

| 경로 | 내용 | 상태 |
|---|---|---|
| `packages/core` | 분석 코어와 CLI. diff → 메서드 매핑 → 호출 순서 비교 → 호출 그래프 → 진입점 → 흐름 정렬 → 테스트 연결 | 2단계 완료 |
| `fixtures/` | 쿠폰 예시 표본 저장소 (Java, Kotlin) | |
| `apps/desktop` | Electron 앱. 시작, 비교 선택, 리뷰 화면(흐름 목록, 메서드 diff, 호출 스택), 정밀 분석 상태 | 4단계 |
| `packages/lsp` | 정밀 분석. JDT LS(Java), kotlin-lsp(Kotlin)로 바뀐 메서드 주변 호출을 확정 | 4단계 |
| `packages/providers`, `packages/llm` | 설계 4.1 참고 | 예정 |

## 코어 CLI 사용

```sh
pnpm install
pnpm build

# git 저장소의 두 ref 비교
node packages/core/dist/cli.js analyze <repo> --base origin/main --head HEAD --summary

# 두 디렉터리 비교 (표본)
node packages/core/dist/cli.js analyze --base-dir fixtures/java/base --head-dir fixtures/java/head --summary
```

`--summary` 출력 예 (Java 표본):

```
▸ POST /orders
   1  진입점  shop.order.OrderController.place
   2  본문   shop.order.OrderService.placeOrder  (⚠ 순서 변경, 테스트 2)
        base: totalAmount → approve → decrease → items → confirm
        head: totalAmount → validateCoupon → decrease → items → approve → couponCode → confirm
   3  추가   shop.order.CouponCalculator.validateCoupon
   4  추가   shop.order.CouponCalculator.discountFor
   5  본문   shop.order.PaymentClient.approve
▸ 진입점 미확정 (1)
   1  본문   shop.order.OrderService.OrderService  (테스트 1)
```

`--summary`를 빼면 설계 6.1의 `ReviewSession` JSON을 출력한다. 진입점 규칙은 저장소 루트의 `.callpath.yml`로 더할 수 있다(설계 5.3).

## 데스크톱 앱 실행

```sh
pnpm install
pnpm build
pnpm --filter @callpath/desktop dev
```

## 정밀 분석

JDK 21 이상이 있으면 처음 분석할 때 JDT LS 1.61.0(약 50MB)을 앱 데이터 폴더에 내려받아 Java 호출을 확정한다. Kotlin은 kotlin-lsp를 설치하면(`brew install JetBrains/utils/kotlin-lsp`) 함께 확정한다. 없으면 이름으로 이은 연결만 쓴다.

| 환경 변수 | 뜻 |
|---|---|
| `CALLPATH_PRECISE=off` | 정밀 분석을 끈다 |
| `CALLPATH_JAVA_HOME` | 쓸 JDK 경로 |
| `CALLPATH_JDTLS_DIR` | 미리 풀어 둔 JDT LS 폴더 |
| `CALLPATH_KOTLIN_LSP` | kotlin-lsp 실행 파일 경로 |
| `CALLPATH_LSP_CACHE` | JDT LS와 head 코드 사본을 둘 폴더 |

## 개발

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @callpath/desktop exec playwright test   # 데스크톱 E2E
```
