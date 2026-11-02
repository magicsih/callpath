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

### macOS 앱 설치

macOS 13 이상에서 Apple Silicon과 Intel을 지원한다.

```sh
brew install --cask magicsih/tap/callpath
```

설치 후 응용 프로그램에서 Callpath를 연다. Node와 pnpm은 개발할 때만 필요하다. Git 저장소 분석에는 Git이 필요하고, Java 정밀 분석은 JDK 21 이상이 있으면 켜진다. 새 버전은 `brew update` 후 `brew upgrade --cask callpath`로 받는다.

[최신 릴리스](https://github.com/magicsih/callpath/releases/latest)에서 ZIP을 직접 받아 설치할 수도 있다. [배포와 검증 절차](docs/releasing.md)를 별도로 기록한다.

### 준비물

| 필요한 것 | 쓰는 곳 |
|---|---|
| Node 24 | 빌드와 실행 |
| pnpm 12.15 | 저장소에 버전이 적혀 있어 `corepack enable`이면 그 버전을 쓴다 |
| git | 로컬 비교와 PR 코드 받기 |
| JDK 21 이상(선택) | Java 정밀 분석. 없으면 이름으로 이은 연결만 쓴다 |
| kotlin-lsp(선택) | Kotlin 정밀 분석 |

처음 실행할 때 두 가지를 인터넷에서 내려받는다.

- Electron 실행 파일: 처음 `dev`를 띄울 때 GitHub에서 받는다. 사내망에서 막히면 `ELECTRON_MIRROR`로 미러를 지정한 뒤 다시 띄운다. 미리 받아 두려면 `pnpm --filter @callpath/desktop run ensure-electron`을 실행한다.
- JDT LS 1.61.0(약 50MB): JDK가 있을 때 처음 분석하면서 Eclipse 배포처에서 받는다. 막히면 미리 풀어 둔 폴더를 `CALLPATH_JDTLS_DIR`로 주거나 `CALLPATH_PRECISE=off`로 끈다.

macOS 개발 실행은 `node_modules/.cache/callpath`에 `Callpath.app` 사본을 만들어 Dock과 앱 전환기에도 Callpath로 표시한다. 설치된 Electron 원본은 바꾸지 않는다. E2E도 같은 사본을 사용한다.

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

기본은 꺼져 있고, 꺼 두면 코드가 앱 밖으로 나가지 않는다. 켜 두면 코드를 열 때 현재 클래스와 메서드 구간을 자동으로 보내 코드 옆에 구간별 설명을 작성한다. 지도에서는 선택한 진입점의 호출 흐름을 설명한다. 별도 흐름 요약이나 메서드 설명 버튼은 기존처럼 보낼 내용을 먼저 확인한다(결정 D22).

1. 시작 화면 맨 아래나 리뷰 화면 오른쪽 아래의 "LLM 설정"으로 들어가 "LLM 설명 쓰기"를 켠다.
2. 끝점 주소에 OpenAI 호환 주소를 `/chat/completions` 앞까지 넣는다(예: `https://llm-gateway.회사.com/v1`). 끝점은 `POST /chat/completions`를 받아야 하고, 주소에 쿼리 값이 꼭 붙어야 하는 방식은 지원하지 않는다.
3. 모델 이름을 넣는다.
4. API 키는 `Authorization: Bearer <키>`로 나간다. 두 가지 중에 고른다.
   - 앱에 넣어 두기: 암호화해 보관하고 다시 보여주지 않는다.
   - 이 컴퓨터의 키 파일에서 읽기: `export 이름=값` 또는 `이름=값` 줄이 있는 파일의 경로와 변수 이름을 넣는다. 앱에는 경로와 이름만 남고 쓸 때마다 파일을 읽는다(결정 D16).
5. 게이트웨이가 다른 헤더 이름을 쓰면 키는 비우고 "추가 헤더"에 `헤더이름: 값`으로 넣는다.
6. "확인하고 저장"을 누르면 `GET /models`만 물어 확인한다. 코드는 보내지 않는다.

보낸 내용과 답은 앱 데이터 폴더의 `llm-log.jsonl`에 남는다. 키와 헤더 값은 남기지 않는다.

코드는 왼쪽, 설명은 오른쪽 분할 창에서 읽는다. 클래스 역할을 먼저 요약하고 조건 검사, 계산, 외부 호출처럼 함께 읽는 코드 구간을 묶어 설명한다. 각 설명에는 실제 줄 범위를 표시하며 누르면 해당 코드로 이동한다. 경계는 드래그와 방향키로 조절하고 두 번 누르면 기본 너비로 돌아간다. 비교에서는 이전 코드와 이후 코드 설명을 선택한다. 원본 파일과 줄 번호, 코드 복사와 diff에는 설명을 섞지 않는다. `설명 표시`로 오른쪽 창을 숨기거나, `멈추기`로 작성을 중단하고 `다시 작성`할 수 있다. 같은 커밋, 코드 구간, 모델과 끝점의 설명은 로컬 캐시를 재사용한다. 큰 파일은 읽는 구간부터 제한된 범위로 설명한다.

키 파일은 `~/.config/keys/api-key.env`처럼 `export LLM_API_KEY=…` 한 줄이 든 파일을 쓸 수 있다. 답 전에 생각 과정을 보내는 모델은 그동안 "모델이 답을 생각하는 중"이 보인다. 생각 과정은 답과 기록에 넣지 않는다.

### 확인한 범위

- macOS와 Ubuntu에서 시험했다(CI). Windows에서는 시험하지 않았다.
- 실제 PR 게시는 GitHub.com에서 확인했다. GitHub Enterprise와 GitLab은 모의 서버로만 시험했다.
- LLM은 모의 끝점과 실제 OpenAI 호환 끝점으로 시험했다.
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
