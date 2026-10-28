# 테스트 계획: 흐름 중심 코드 리뷰 앱 1차

- 설계: [README.md](README.md) v0.1
- 등급: L1 (바뀐 기능, 개발 환경, 작성자 실행)
- 실행 환경: `dev` (macOS, Node 24, pnpm, Electron 개발 모드)
- 실기기: 없음. 데스크톱 앱이며 모바일 경로가 없다
- 출시 범위: 마켓 없음. 끝 지점은 GitHub Release에 macOS dmg 아티팩트 업로드(1차 마지막 단계에서만). 심사와 공개 전환 없음
- 하한 낮춤: 해당 없음

## 왜 L1인가

새 저장소의 첫 제품이고 기존 사용자 경로가 없다. 네이티브 SDK, 결제, 인증, 권한처럼 개발 환경에서 확인할 수 없는 항목이 없다. 모든 인수조건은 fixture 저장소와 Electron 개발 모드에서 확인할 수 있다.

## 표본 저장소 (fixtures)

쿠폰 예시를 Java와 Kotlin으로 각각 재현한다. 두 저장소는 `base`와 `head` 브랜치를 가지며 다음을 포함한다.

| 파일 | base | head |
|---|---|---|
| `OrderController` | `POST /orders` → `placeOrder` | 변경 없음 |
| `OrderService.placeOrder` | approve → decrease → confirm | validateCoupon → decrease → approve → confirm |
| `CouponCalculator` | 없음 | 새 클래스 |
| `PaymentClient.approve` | `approve(amount)` | `approve(discounted)` 시그니처 변경 |
| `StockRepository.decrease` | 변경 없음 | 변경 없음 |
| `OrderServiceTest` | 기존 테스트 | 쿠폰 금액 테스트 추가 |
| `OrderCleanupJob` (`@Scheduled`) | 변경 없음 | 변경 없음 (변경 집합과 무관한 진입점은 흐름을 만들지 않아야 함) |

## 인수조건과 검증 방법

| 번호 | 인수조건 | 방법 | 단계 |
|---|---|---|---|
| A1 | `placeOrder` 단계에 `callOrderDiff.moved`가 비어 있지 않다 | vitest, core CLI 출력 JSON 단언 | 1 |
| A2 | 모든 변경 hunk가 flows, orphans, otherTests, nonCode 중 한 곳 이상에 있다 | fast-check 속성 테스트 (무작위 hunk 분할) | 1 |
| A3 | `POST /orders` 흐름이 OrderController, OrderService, CouponCalculator, PaymentClient 순서를 포함한다 | vitest 스냅샷 | 2 |
| A4 | `OrderCleanupJob`은 흐름 목록에 없다 | vitest | 2 |
| A5 | `OrderServiceTest`는 기본 숨김이고, 토글을 켜면 `placeOrder` 단계 아래에 나타난다 | Playwright for Electron | 3 |
| A6 | `j`/`k`로 단계가 이동하고 하단 카운터가 바뀐다, 호출 스택이 현재 단계를 가리킨다 | Playwright | 3 |
| A7 | 앱 재시작 뒤 마지막 저장소, 단계, 토글 상태가 복원된다 | Playwright (재기동) | 3 |
| A8 | JDK 21이 있으면 JDT LS 보강 뒤 `placeOrder → approve` 간선이 `high`다. JDK가 없으면 상단 띠가 뜨고 A1~A7이 그대로 통과한다 | vitest 통합(JDK 조건부), Playwright | 4 |
| A9 | 공개 테스트 저장소의 PR을 열어 base/head가 맞고 코멘트가 게시된다 | 수동 1회 + 기록, 게시 대상은 사용자 소유 테스트 저장소 | 5 |
| A10 | LLM 버튼은 미리보기 없이는 전송하지 않고, 전송 내용이 `llm-log.jsonl`에 남는다 | 로컬 모의 OpenAI 호환 서버로 vitest | 6 |
| A11 | 변경 파일 50개, 메서드 300개 합성 저장소에서 빠른 분석 3초 이내 | vitest 벤치, Apple M 시리즈 | 2 |

## 실행 규칙

- 단계 PR마다 그 단계까지의 인수조건을 CI(GitHub Actions, ubuntu + macOS)에서 돌린다. LSP 통합 테스트는 `JAVA_HOME`이 있을 때만 실행하고 없으면 건너뜀을 로그에 남긴다.
- Playwright 실행은 CI macOS 러너에서 하고 실패 시 스크린샷을 아티팩트로 남긴다. 저장소에는 넣지 않는다.
- A9는 자동화하지 않는다. 실행 날짜, PR 주소, 결과를 PR 본문에 적는다.
- 계획보다 테스트를 줄여야 하면 다시 승인받는다.
