# Callpath

AI가 한 번에 고쳐 올린 PR을 파일 순서가 아니라 호출 흐름 순서로 읽는 데스크톱 리뷰 앱. 진입점부터 변경 메서드를 따라가고, 메서드 안의 호출 순서가 바뀐 곳을 표시하고, 테스트 코드는 토글로 분리해 본다. Java, Kotlin이 1차 대상이다.

- 설계: [docs/design/2026-10-28-flow-review/README.md](docs/design/2026-10-28-flow-review/README.md)
- 테스트 계획: [docs/design/2026-10-28-flow-review/test-plan.md](docs/design/2026-10-28-flow-review/test-plan.md)
- 결정 기록: [docs/design/2026-10-28-flow-review/decisions.md](docs/design/2026-10-28-flow-review/decisions.md)

## 구성

| 경로 | 내용 | 단계 |
|---|---|---|
| `packages/core` | 분석 코어와 CLI. diff → 메서드 매핑 → 호출 순서 비교 → 호출 그래프 → 진입점 → 흐름 정렬 → 테스트 연결 | 1, 2 |
| `packages/lsp` | 정밀 분석. JDT LS(Java), kotlin-lsp(Kotlin)로 바뀐 메서드 주변 호출을 확정 | 4 |
| `packages/providers` | GitHub, GitHub Enterprise, GitLab PR 읽기, diff 범위, 코드 받기, 코멘트 게시 | 5 |
| `packages/llm` | OpenAI 호환 끝점으로 흐름 요약과 메서드 설명. 보낼 내용 만들기, 스트리밍, 키 파일 읽기 | 6 |
| `apps/desktop` | Electron 앱. 비교 선택, 리뷰 화면, 정밀 분석 상태, 연결 설정, PR 열기, 메모와 게시, LLM 설명 | 3~6 |
| `fixtures/` | 쿠폰 예시 표본 저장소 (Java, Kotlin) | |

1차 범위(설계 10절 1~6단계)를 마쳤다. 2차인 새 레포 안내자(7단계)는 아직 시작하지 않았다.

## 새 PC에서 시작하기

### 준비물

| 필요한 것 | 쓰는 곳 |
|---|---|
| Node 24 | 빌드와 실행 |
| pnpm 12.15 | 저장소에 버전이 적혀 있어 `corepack enable`이면 그 버전을 쓴다 |
| git | 로컬 비교와 PR 코드 받기 |
| JDK 21 이상(선택) | Java 정밀 분석. 없으면 이름으로 이은 연결만 쓴다 |
| kotlin-lsp(선택) | Kotlin 정밀 분석 |

처음 실행할 때 두 가지를 인터넷에서 내려받는다.

- Electron 실행 파일: GitHub에서 받는다. 사내망에서 막히면 `ELECTRON_MIRROR`로 미러를 지정한다.
- JDT LS 1.61.0(약 50MB): JDK가 있을 때 처음 분석하면서 Eclipse 배포처에서 받는다. 막히면 미리 풀어 둔 폴더를 `CALLPATH_JDTLS_DIR`로 주거나 `CALLPATH_PRECISE=off`로 끈다.

### 설치와 실행

```sh
git clone https://github.com/magicsih/callpath.git
cd callpath
corepack enable
pnpm install
pnpm build
pnpm --filter @callpath/desktop dev
```

앱 데이터(연결, LLM 설정, 메모, 보낸 기록, 캐시)는 OS의 앱 데이터 폴더에 둔다. macOS는 `~/Library/Application Support/Callpath`, Linux는 `~/.config/Callpath`, Windows는 `%APPDATA%\Callpath`다. 토큰과 키는 PC마다 OS 암호 저장소로 암호화되므로 다른 PC로 파일을 복사해도 쓸 수 없다. PC마다 다시 등록한다.

### 사내 GitHub(GitHub Enterprise) 연결

1. 시작 화면의 PR 주소 칸 아래 "연결 설정"을 누르고 제공자로 "GitHub Enterprise"를 고른다.
2. 호스트에 `github.회사.com`처럼 이름만 넣는다. http 서버면 `http://`까지 넣는다.
3. 토큰을 넣는다. 클래식 토큰은 `repo` 권한, fine-grained 토큰은 Pull requests 읽기와 쓰기, Contents 읽기가 필요하다. SSO를 쓰는 조직이면 토큰을 그 조직에 승인한다.
4. "연결 저장"을 누르면 `/api/v3/user`로 확인하고 사용자 이름을 보인다.
5. 시작 화면에 PR 주소(`https://github.회사.com/org/repo/pull/123`)를 넣어 연다. 사내 GitHub를 원격으로 둔 로컬 클론을 열면 비교 화면에 그 저장소의 열린 PR 목록이 보인다.

GitHub.com은 로그인된 gh CLI 계정을 그대로 쓸 수 있지만, GitHub Enterprise는 토큰을 넣어야 한다. GitLab도 같은 화면에서 api 권한 토큰으로 연결한다.

### LLM 설명 켜기

기본은 꺼져 있고, 꺼 두면 코드가 앱 밖으로 나가지 않는다. 켜도 흐름 요약이나 메서드 설명 버튼을 누를 때마다 보낼 내용을 먼저 보이고, "보내기"를 눌러야 보낸다(결정 D15).

1. 시작 화면 맨 아래나 리뷰 화면 오른쪽 아래의 "LLM 설정"으로 들어가 "LLM 설명 쓰기"를 켠다.
2. 끝점 주소에 OpenAI 호환 주소를 `/chat/completions` 앞까지 넣는다(예: `https://llm-gateway.회사.com/v1`). 끝점은 `POST /chat/completions`를 받아야 하고, 주소에 쿼리 값이 꼭 붙어야 하는 방식은 지원하지 않는다.
3. 모델 이름을 넣는다.
4. API 키는 `Authorization: Bearer <키>`로 나간다. 두 가지 중에 고른다.
   - 앱에 넣어 두기: 암호화해 보관하고 다시 보여주지 않는다.
   - 이 컴퓨터의 키 파일에서 읽기: `export 이름=값` 또는 `이름=값` 줄이 있는 파일의 경로와 변수 이름을 넣는다. 앱에는 경로와 이름만 남고 쓸 때마다 파일을 읽는다(결정 D16).
5. 게이트웨이가 다른 헤더 이름을 쓰면 키는 비우고 "추가 헤더"에 `헤더이름: 값`으로 넣는다.
6. "확인하고 저장"을 누르면 `GET /models`만 물어 확인한다. 코드는 보내지 않는다.

보낸 내용과 답은 앱 데이터 폴더의 `llm-log.jsonl`에 남는다. 키와 헤더 값은 남기지 않는다.

#### MiniMax

"MiniMax로 채우기"를 누르면 끝점 `https://api.minimax.io/v1`, 모델 `MiniMax-M3.1-Flash`, 변수 이름 `MINIMAX_API_KEY`가 채워진다. MiniMax M Plan 키(`sk-cp-`로 시작)를 쓴다. 키 파일이 있으면 "이 컴퓨터의 키 파일에서 읽기"를 고르고 그 경로를 넣는다. 예를 들어 `~/.config/keys/minimax-api-key.env`처럼 `export MINIMAX_API_KEY=…` 한 줄이 든 파일이다. MiniMax는 답 전에 생각 과정을 보내므로, 그동안 "모델이 답을 생각하는 중"이 보인다. 생각 과정은 답과 기록에 넣지 않는다.

### 확인한 범위

- macOS와 Ubuntu에서 시험했다(CI). Windows에서는 시험하지 않았다.
- 실제 PR 게시는 GitHub.com에서 확인했다. GitHub Enterprise와 GitLab은 모의 서버로만 시험했다.
- LLM은 모의 끝점과 실제 MiniMax로 시험했다.
- 회사망에서 프록시를 거쳐야 할 때 앱의 API 요청이 시스템 프록시를 따르는지는 확인하지 않았다.

## 정밀 분석

JDK 21 이상이 있으면 처음 분석할 때 JDT LS 1.61.0을 앱 데이터 폴더에 내려받아 Java 호출을 확정한다. Kotlin은 kotlin-lsp를 설치하면(`brew install JetBrains/utils/kotlin-lsp`) 함께 확정한다. 없으면 이름으로 이은 연결만 쓴다.

| 환경 변수 | 뜻 |
|---|---|
| `CALLPATH_PRECISE=off` | 정밀 분석을 끈다 |
| `CALLPATH_JAVA_HOME` | 쓸 JDK 경로 |
| `CALLPATH_JDTLS_DIR` | 미리 풀어 둔 JDT LS 폴더 |
| `CALLPATH_KOTLIN_LSP` | kotlin-lsp 실행 파일 경로 |
| `CALLPATH_LSP_CACHE` | JDT LS와 head 코드 사본을 둘 폴더 |

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

## 개발

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @callpath/desktop exec playwright test   # 데스크톱 E2E
```

## 라이선스

[MIT](LICENSE)
