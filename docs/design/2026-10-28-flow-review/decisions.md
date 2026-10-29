# 결정 기록

형식: 배경, 선택, 대안, 결과. 번호는 설계 본문의 D 번호와 같다.

## D1. Electron 독립 앱

- 배경: 사용자의 주 언어는 Java, Kotlin이고 주 IDE는 IntelliJ IDEA다. 다양한 플랫폼 호환을 원했다.
- 선택: Electron 독립 앱. 분석 코어는 Electron에 의존하지 않는 TypeScript 패키지로 분리한다.
- 대안:
  - VS Code 확장: `vscode.prepareCallHierarchy`, `vscode.provideIncomingCalls` 같은 내장 명령으로 설치된 언어 서버의 호출 계층을 공짜로 얻는다. 그러나 리뷰 도구가 VS Code 안에 묶이고, Java/Kotlin 정밀 분석을 위한 "Java & Kotlin by IntelliJ IDEA" 확장은 2026년 10월 v1.0부터 IntelliJ IDEA Ultimate 구독이 필요하다.
  - IntelliJ 플러그인: PSI 기반 분석으로 정확도가 가장 높고 사용자의 주 IDE다. 그러나 JetBrains 전용이고 플러그인 UI 제약이 커서 세 영역 리뷰 화면을 자유롭게 만들기 어렵다.
- 결과: 분석 엔진을 앱이 직접 책임진다(D2). 코어를 분리해 두어 뒤에 VS Code 확장이나 다른 껍데기를 붙일 수 있다.

## D2. tree-sitter 1계층 + LSP 2계층

- 배경: JDT LS와 kotlin-lsp는 모두 Gradle/Maven 프로젝트 import가 끝나야 호출 계층을 답한다. 첫 import는 수십 초에서 수 분이 걸리고 빌드 설정이 깨진 저장소에서는 실패한다. 리뷰 도구는 열자마자 읽을 수 있어야 한다.
- 선택: tree-sitter로 즉시 심볼과 이름 기반 호출 간선을 만들어 흐름을 보여주고, LSP는 변경 메서드 주변만 질의해 간선을 확정하거나 제거한다.
- 대안:
  - LSP 단독: 정확하지만 첫 화면까지 오래 걸리고 import 실패 시 아무것도 보여줄 수 없다.
  - 바이트코드 분석(WALA, Soot): 빌드 산출물이 필요하고 Kotlin 지원과 소스 위치 매핑이 번거롭다.
  - tree-sitter 단독: 오버로드, 다형성, 인터페이스 호출을 틀리게 연결한다. 쿠폰 예시의 핵심인 "같은 메서드 안의 호출 순서 변경"은 1계층만으로도 잡히지만 흐름 연결은 오탐이 있다.
- 결과: 간선에 출처와 신뢰도를 달고 화면에 점선으로 구분한다. 신뢰도가 낮은 연결을 사실처럼 보이게 하지 않는다.

## D3. kotlin-lsp는 번들하지 않고 탐지

- 배경: JetBrains kotlin-lsp는 알파 단계이고 README가 "부분 비공개 소스(JetBrains Air, Fleet의 비공개 부분 포함)"라고 밝힌다. 재배포 조건을 확인하지 못했다.
- 선택: 앱은 kotlin-lsp를 내려받거나 포함하지 않는다. PATH 또는 설정 경로에 사용자가 설치한 실행 파일(`brew install JetBrains/utils/kotlin-lsp`)이 있으면 쓴다.
- 대안: 앱이 자동 내려받기. 편리하지만 라이선스 확인 전에는 하지 않는다. 확인되면 설정의 "설치" 버튼으로 바꿀 수 있다.
- 결과: Kotlin 저장소는 kotlin-lsp 없이도 1계층으로 동작한다. JDT LS는 EPL 2.0이므로 앱이 Eclipse 스냅샷을 내려받아 기동한다.

## D4. OpenAI 호환 끝점

- 배경: 리뷰 대상에 회사 코드가 포함될 수 있다. 코드를 어디로 보내는지 사용자가 통제해야 한다.
- 선택: `/v1/chat/completions` 형식의 끝점, 모델, 키, 추가 헤더를 설정에서 받는다. 사내 게이트웨이, 로컬 모델(Ollama 등), 외부 공급자를 같은 인터페이스로 쓴다. 기본은 꺼짐이고 전송 전 미리보기와 로컬 전송 로그를 둔다.
- 대안: 특정 공급자 SDK 직접 사용. 기능은 더 쓸 수 있지만 사내 끝점과 로컬 모델을 따로 지원해야 한다.
- 결과: LLM 기능은 모두 "있으면 더 좋은" 보강으로 설계하고 정적 분석 결과에 의존하지 않게 한다.

## D5. 다이어그램은 Mermaid

- 배경: 설계는 시각 자료를 중심으로 쓰고 GitHub에서 바로 읽혀야 한다.
- 선택: Markdown 안 Mermaid 블록. 렌더링 도구 의존이 없고 diff로 검토할 수 있다.
- 대안: SVG/PNG 이미지. 더 자유롭지만 수정할 때마다 다시 그려야 하고 저장소에 바이너리가 쌓인다.
- 결과: 와이어프레임처럼 Mermaid로 표현하기 어려운 것만 고정폭 텍스트로 둔다.

## D6. 모노레포와 코어 CLI

- 배경: 분석 로직을 Electron 없이 테스트하고, 2차에 다른 껍데기를 붙이고, CI에서 fixture를 돌려야 한다.
- 선택: pnpm 워크스페이스. `packages/core`에 `callpath analyze` CLI를 두어 JSON을 출력한다. 앱은 같은 함수를 worker에서 호출한다.
- 결과: 인수조건 A1~A4, A11은 CLI와 vitest만으로 검증한다.

## D7. tree-sitter는 wasm으로, Kotlin 문법은 tree-sitter-grammars 패키지

- 배경: 1단계 구현에서 확인한 사실. npm `tree-sitter-kotlin`(fwcd) 0.3.8은 prebuild와 wasm이 없어 node-gyp 빌드가 필요하고, Electron에서는 ABI별 재빌드가 따라온다.
- 선택: `web-tree-sitter` 0.27과 각 문법 패키지에 포함된 wasm(`tree-sitter-java` 0.23.5, `@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0, MIT)을 쓴다. pnpm `allowBuilds`로 두 문법 패키지의 네이티브 빌드 스크립트를 명시적으로 끈다.
- 대안: node-tree-sitter 네이티브 바인딩. 더 빠르지만 Electron 버전마다 재빌드가 필요하고 Kotlin은 prebuild가 없다.
- 결과: 설계 4.3의 분석 워커 설명을 wasm으로 고쳤다. 성능 기준(7절, 빠른 분석 3초)은 wasm 기준으로 2단계에서 측정한다.

## D8. 앱 이름 Callpath

- 배경: 설계와 1, 2단계 구현 동안 임시 이름 `flow-review`를 썼다. Electron 앱 이름과 앱 ID를 정하기 전에 이름이 필요했다.
- 선택: Callpath. 진입점에서 호출 경로를 따라 읽는다는 핵심 기능이 이름에 드러난다. 2026-10-28 확인 시 npm 이름이 비어 있고 GitHub 동명 저장소는 14개였다.
- 대안: Flowread(동명 저장소 73개로 흔함), Reviewpath(덜 구체적), Tracewise(PyPI에 같은 이름의 LLM 추적 SDK가 있음), codereview(일반명사라 구분이 어려움).
- 결과: 패키지는 `@callpath/core`, CLI는 `callpath`, 진입점 규칙 파일은 `.callpath.yml`, 저장소는 `magicsih/callpath`. 설계 폴더 이름은 링크 보존을 위해 그대로 둔다.

## D9. 데스크톱 화면 구성 (3단계)

- 배경: 3단계에서 Electron 화면을 처음 만들었다. 빌드 도구, 편집기, 화면 상태 저장 방식을 정해야 했다.
- 선택:
  - electron-vite 6과 React 19. main은 코어가 ESM이라 ESM으로 내고, preload는 sandbox를 위해 CommonJS로 둔다. 분석은 `worker_threads` 워커에서 돌린다.
  - 편집기는 `monaco-editor` 0.57을 앱에 넣어 쓴다. `@monaco-editor/react`는 기본으로 CDN에서 불러오고 2025년 2월 이후 갱신이 없어 쓰지 않는다. 외부 요청이 없도록 CSP로 `self`만 허용한다.
  - 메서드 단계는 base와 head의 메서드 범위만 잘라 비교하고, 줄 번호는 원래 파일 기준으로 보인다. 파일과 테스트는 파일 전체를 비교하고 바뀌지 않은 구간을 접는다.
  - 화면 상태는 `state.json`에 임시 파일을 거쳐 쓴다. 분석 캐시는 4단계로 미룬다(설계 4.4).
  - 좁은 창(CSS 폭 820px 이하)에서는 호출 스택을 가운데 아래로 내리고, 낮은 창(높이 560px 미만)에서는 호출 순서 띠를 요약 한 줄로 접는다.
- 대안: VS Code의 웹뷰 구성 요소를 가져오는 방식, CodeMirror. Monaco가 diff 편집기를 기본으로 갖고 있어 골랐다.
- 결과: 렌더러 번들이 약 5.6MB다. 데스크톱 앱이라 받아들인다.

## D10. JDT LS 1.61.0 고정, 실행 JDK는 21 이상

- 배경: 4단계에서 최신 마일스톤 1.62.0을 실행하니 Eclipse 플랫폼 번들(`org.eclipse.core.filesystem`)이 Java 25를 요구해 Java 22에서 시작하지 못했다(종료 코드 13). 1.61.0은 Java 25를 요구하는 번들이 선택 기능인 javac 기반 컴파일러 하나뿐이고 Java 21 이상에서 동작했다.
- 선택: 1.61.0(2026-09-03)을 고정하고 내려받은 파일의 SHA-256을 확인한다. JDK는 `CALLPATH_JAVA_HOME`, `JAVA_HOME`, CI 러너의 `JAVA_HOME_<버전>_*`, macOS `java_home`, PATH 순으로 찾는다.
- 대안: 최신판을 따라가며 Java 25를 요구. 리뷰어 대부분이 이미 쓰는 JDK 21 LTS를 막을 이유가 없다.
- 결과: JDT LS를 올릴 때는 실행 JDK 요구를 다시 확인한다. 1.62 이상으로 올리면 최소 JDK가 25가 된다.

## D11. 정밀 분석 결과만 세션 단위로 캐시

- 배경: 설계 4.4는 파일, 심볼, 간선, 세션, 메모 표를 두었다. 측정해 보니 빠른 분석은 표본 56ms, spring-petclinic 100ms 안팎이고, 비싼 것은 JDT LS 실행과 질의(표본 약 7초)다.
- 선택: 정밀 분석까지 끝난 세션만 `node:sqlite`에 저장한다. 키는 저장소, base SHA, head SHA, 분석기 버전(워커 파일 해시와 JDT LS 버전)이다. 저장소마다 최근 20개만 남긴다. head 코드 사본과 LSP 작업 폴더는 최근 5개만 남긴다.
- 대안: better-sqlite3. Electron 버전마다 네이티브 재빌드가 필요하다(D7과 같은 이유로 피함).
- 결과: 같은 비교를 다시 열면 바로 정밀 분석 결과가 보인다. 메모 표는 5단계에서 같은 DB에 더한다.

## D12. 제공자 API는 fetch로 직접

- 배경: 설계 4.1은 GitHub에 Octokit을 적었다. 필요한 API가 PR 읽기, 파일 목록, 코멘트 쓰기 몇 개뿐이고 GitLab은 어차피 따로 만든다.
- 선택: Node 내장 `fetch`로 GitHub, GHE, GitLab REST를 부른다. 같은 인터페이스(설계 6.2) 뒤에 둔다.
- 결과: 의존성이 늘지 않고, 모의 서버 테스트가 같은 HTTP 경로를 그대로 검증한다.

## D13. GitHub.com은 로그인된 gh CLI 계정을 쓴다

- 배경: 리뷰어 대부분은 이미 `gh auth login`을 했다. 토큰을 또 만들어 앱에 넣게 하면 같은 비밀이 두 곳에 생긴다.
- 선택: GitHub.com 연결 방식에 "gh CLI 계정 쓰기"를 두고, 실행 중에 `gh auth token`으로 읽어 메모리에만 둔다. gh가 없거나 다른 계정을 쓰려면 토큰을 넣는다.
- 결과: 토큰은 화면, 로그, 파일 어디에도 남지 않는다. GHE와 GitLab은 토큰을 암호화해 저장한다.

## D14. PR 코드는 앱 캐시의 bare 저장소로 받는다

- 배경: PR을 분석하려면 base와 head 커밋이 로컬에 있어야 한다. 사용자가 연 저장소에 PR ref를 받아 넣으면 그 저장소가 바뀐다.
- 선택: 앱 데이터 폴더에 저장소마다 bare 저장소를 두고 base 브랜치와 PR head만 받는다. 토큰은 `-c http.extraHeader`로 명령에만 넘긴다.
- 결과: 같은 저장소의 다음 PR은 받은 이력을 재사용한다. 캐시 지우기는 이 폴더를 지운다.

## D15. LLM 전송은 항상 미리보기 뒤에만, 확인 끄기는 두지 않는다

- 배경: 설계 3.5의 설정 목록에 "전송 확인 끄기 여부"가 있었다. 같은 설계 3.4는 "자동 전송은 없다", 테스트 계획 A10은 "미리보기 없이는 전송하지 않는다"고 적어 서로 맞지 않았다. 리뷰 대상에는 회사 코드가 들어갈 수 있다.
- 선택: 더 엄격한 쪽을 따른다. 모든 전송은 미리보기 대화상자에서 "보내기"를 눌러야 나가고, 이 확인을 끄는 설정은 만들지 않는다. 미리보기 내용은 main 프로세스에 맡겨 두고 id로 보내 미리보기와 다른 내용이 나갈 길을 없앴다.
- 대안: 확인 끄기를 두고 첫 전송 때 한 번 묻기. 반복 사용이 빨라지지만, 끈 상태를 잊고 다른 저장소에서 버튼을 누르면 확인 없이 코드가 나간다.
- 결과: 설계 3.5의 설정 항목에서 "전송 확인 끄기 여부"를 뺐다. 확인을 줄이고 싶다는 요구가 생기면 저장소별 허용처럼 범위를 좁힌 방식을 다시 검토한다.
