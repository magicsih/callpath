# 테스트 계획: 흐름 중심 코드 리뷰 앱 1차

- 설계: [README.md](README.md) v0.1
- 등급: L1 (바뀐 기능, 개발 환경, 작성자 실행)
- 실행 환경: `dev` (macOS, Node 24, pnpm, Electron 개발 모드)
- 실기기: 없음. 데스크톱 앱이며 모바일 경로가 없다
- 출시 범위: 마켓 없음. 끝 지점은 GitHub Release에 macOS dmg 아티팩트 업로드(1차 마지막 단계에서만). 심사와 공개 전환 없음
- 하한 낮춤: 해당 없음
- 새 화면: 3단계(데스크톱 화면)는 새 화면이므로 `redesign: true`로 보고, 기능 인수조건과 별도로 작성자와 다른 검수 에이전트가 실제 실행 화면으로 독립 검수 3회를 한다(아래 "새 화면 독립 검수")

## 왜 L1인가

새 저장소의 첫 제품이고 기존 사용자 경로가 없다. 네이티브 SDK, 결제, 인증, 권한처럼 개발 환경에서 확인할 수 없는 항목이 없다. 모든 인수조건은 fixture 저장소와 Electron 개발 모드에서 확인할 수 있다.

## 표본 저장소 (fixtures)

쿠폰 예시를 Java와 Kotlin으로 각각 재현한다. 중첩 git 저장소를 피하기 위해 `fixtures/<lang>/base`, `fixtures/<lang>/head` 디렉터리로 두 시점을 둔다. git ref 경로는 테스트가 임시 저장소를 만들어 확인한다. 각 표본은 다음을 포함한다.

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
| A12 | 시작, 비교 선택, 리뷰 화면의 빈 상태, 분석 중, 오류 상태가 화면별 기록(설계 3.6)대로 보인다 | Playwright, 상태별 스크린샷 | 3 |
| A13 | 창 크기 900x600과 화면 확대 150%에서 세 영역의 핵심 정보와 버튼이 잘리거나 겹치지 않는다 | Playwright 스크린샷, 검수 에이전트 확인 | 3 |
| A14 | 마우스 없이 키보드만으로 저장소 열기부터 마지막 단계까지 갈 수 있고, 목록과 버튼에 화면 읽기용 이름이 있다 | Playwright 키보드 시나리오, 접근성 트리 확인 | 3 |
| A8 | JDK 21이 있으면 JDT LS 보강 뒤 진입점에서 `placeOrder`까지의 간선과 그 테스트 연결이 `high`이고, 이름만으로는 후보가 여럿이던 호출을 하나로 확정한다. 정밀 분석 결과가 와도 보던 위치와 코드가 그대로이고, 다시 열면 저장한 결과를 쓴다. JDK나 kotlin-lsp가 없으면 상단 띠에 원인과 설치 안내가 뜨고 A1~A7이 그대로 통과한다 | vitest 통합(JDK 조건부), Playwright | 4 |
| A9 | 실제 GitHub PR(`seorilabs/lucid-chess#32`, 사용자 지정)을 주소로 열어 base/head가 PR과 같고, 줄 코멘트를 게시한 뒤 바로 지운다. GitHub Enterprise와 GitLab은 모의 서버로 같은 흐름(목록, 열기, 줄 코멘트, 일반 코멘트)을 확인한다 | vitest(모의 서버). 실제 PR 읽기는 `CALLPATH_LIVE_PR`로 작성자가 실행했다(2026-10-29, base cc23bf3, head 2bd321e, 파일 2개 일치). 게시와 삭제(`CALLPATH_LIVE_POST=1`)는 에이전트 권한에서 막혀 사용자가 직접 실행한다 | 5 |
| A15 | 연결 설정에서 저장한 토큰은 암호화되어 파일에 평문으로 남지 않고 화면에 다시 보이지 않는다. 잘못된 토큰은 원인과 함께 실패로 보인다 | Playwright(모의 서버), 파일 검사 | 5 |
| A16 | 메모를 남기면 줄 옆과 목록에 보이고, 다시 열어도 남는다. 변경 브랜치에 커밋이 더해지면 이전 커밋 메모로 따로 보인다 | Playwright | 5 |
| A17 | 게시 미리보기가 줄 코멘트와 일반 코멘트를 구분해 보이고, 확인해야 올라가며, 올라간 메모는 링크와 함께 게시됨으로 바뀐다 | Playwright(모의 서버) | 5 |
| A10 | LLM 버튼은 미리보기 없이는 전송하지 않고, 전송 내용이 `llm-log.jsonl`에 남는다 | 로컬 모의 OpenAI 호환 서버로 vitest(`packages/llm`: 미리보기, 스트리밍, 한 번에 온 답, 키 거부와 가림, 멈춤과 시간 초과, 모델 목록)와 Playwright(설정 저장은 모델 목록만, 미리보기 취소 시 전송 0건, 보낸 메시지가 미리보기와 같음, 기록 두 줄, 키가 파일에 없음, 키 거부 안내, 좁은 창 버튼 위치) | 6 |
| A11 | 변경 파일 50개, 메서드 300개 합성 저장소에서 빠른 분석 3초 이내 | vitest 벤치, Apple M 시리즈 | 2 |

## 실행 규칙

- 단계 PR마다 그 단계까지의 인수조건을 CI(GitHub Actions)에서 돌린다. PR은 ubuntu, main 반영은 ubuntu와 macOS다. 비공개 저장소의 macOS 분당 과금 배수 때문이다. LSP 통합 테스트는 `JAVA_HOME`이 있을 때만 실행하고 없으면 건너뜀을 로그에 남긴다.
- Playwright 실행은 CI macOS 러너에서 하고 실패 시 스크린샷을 아티팩트로 남긴다. 저장소에는 넣지 않는다.
- A9는 자동화하지 않는다. 실행 날짜, PR 주소, 결과를 PR 본문에 적는다.
- 계획보다 테스트를 줄여야 하면 다시 승인받는다.

## 새 화면 독립 검수 (3단계)

- 실행 환경: macOS, Electron 개발 빌드(`electron-vite build` 산출물), 쿠폰 표본을 커밋 두 개로 만든 임시 git 저장소, 격리된 앱 데이터 폴더
- 검수자: 구현자와 다른 검수 에이전트. 회차마다 새 에이전트로 시작하고 앞 회차 결론을 넘기지 않는다
- 회차마다 계획, 기대 결과, 환경, 격리 데이터, 증거, 검수자를 `ui-review.md`에 먼저 적고, 기능(A5, A6, A7, A12~A14)과 UX(설계 3.6의 목적, 정보량, 상태 표현)를 모두 확인한다
- 증거 스크린샷은 작업 전용 폴더에 만들고 검수가 끝나면 NAS로 옮긴다. 저장소에는 요약과 NAS 위치만 남긴다
- 3회 뒤에도 해결되지 않은 문제가 남으면 문제, 추가 회차, 범위, 시간, 중단 영향을 정리해 승인받기 전에는 다음 회차를 시작하지 않는다

## 새 화면 독립 검수 (5단계)

연결 설정, PR 열기, 메모와 게시 미리보기는 새 화면이므로 3단계와 같은 방식으로 독립 검수 3회를 한다. 실제 외부 게시는 검수에 쓰지 않고 모의 서버로 한다. 기록은 `ui-review-stage5.md`에 남긴다.
