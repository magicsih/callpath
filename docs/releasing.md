# macOS와 Homebrew 배포

사용자의 Homebrew 배포 요청에 따라 GitHub의 정식 공개 릴리스와 `magicsih/tap` cask까지 진행한다. 앱 화면은 바꾸지 않는다. macOS 13 이상, Apple Silicon과 Intel을 지원하는 universal 앱을 만든다. 설치된 Node나 pnpm 없이 실행되며 Git 저장소 분석에는 Git, 선택적인 Java 정밀 분석에는 JDK 21이 필요하다.

## 검증 범위

L3, 개발 환경 전체 회귀를 CI에서 실행한다. Ubuntu와 macOS에서 빌드, 타입 검사, 단위 테스트, 전체 데스크톱 E2E를 돌린다. macOS는 Apple Silicon과 Intel에서 production 의존성으로 만든 설치 패키지의 전체 E2E도 실행한다. 분석 worker, Java와 Kotlin의 WASM, 정밀 분석, 저장, 지도, LLM 가상 주석을 포함한다. 공증한 universal 후보와 실제 공개 다운로드 파일에서도 실행한다. 기기 사용은 필요 없다.

기존 설치와 사용자 데이터를 보존한다. 마지막 설치 검증은 별도 앱 폴더에 Homebrew로 설치해 실행한다. 코드 서명, Apple 공증, Gatekeeper, 정식 공개 릴리스, cask 검사와 설치는 각각 확인한다. Windows 배포는 이번 범위에 포함하지 않는다.

## 후보 만들기

`apps/desktop/package.json`의 버전을 올리고 PR을 병합한다. 정확히 그 커밋의 CI가 성공한 뒤 깨끗한 작업 트리에서 진행한다. 서명 identity는 기존 Developer ID를 사용하며 비밀 키와 비밀번호를 저장소에 넣지 않는다.

```sh
pnpm install --frozen-lockfile
pnpm build
CALLPATH_SIGN_IDENTITY='<existing Developer ID identity>' CALLPATH_CI_RUN='<successful CI run ID>' \
  pnpm package:macos "$PWD/release/0.1.0"
CALLPATH_E2E_EXECUTABLE="$PWD/release/0.1.0/Callpath.app/Contents/MacOS/Callpath" \
  pnpm --filter @callpath/desktop exec playwright test
python3 scripts/finalize-macos.py prepare release/0.1.0
```

`pnpm deploy --prod`와 `node-linker=hoisted`로 workspace 의존성을 포함한 독립 폴더를 만든다. WASM과 worker 경로를 보존하기 위해 ASAR로 묶지 않는다. 출력 폴더는 새로 만들어야 하며 기존 후보를 덮어쓰지 않는다. 서명 오류는 빌드를 실패시킨다. 서명에는 hardened runtime과 JIT 실행 권한만 부여한다.

macOS E2E는 `--use-mock-keychain`으로 테스트 키와 사용자의 키체인을 분리한다. 이는 테스트 실행 인자이며 배포 앱의 일반 실행에는 적용하지 않는다. E2E 결과가 실제 키체인 권한 승인을 검증한 것으로 해석되어서는 안 된다.

## 공증과 공개

등록된 App Store Connect API 키를 `notarytool`에 직접 전달해 `notarization-upload.zip`을 제출한다. 키 값은 출력하거나 기록하지 않는다. `--output-format json`으로 받은 Accepted 영수증만 다음 단계에 사용한다.

```sh
python3 scripts/finalize-macos.py finalize release/0.1.0 --receipt /private/path/notary-receipt.json
```

공증 제출 뒤 후보가 바뀌었으면 실패한다. 공증 티켓을 앱에 붙이고 서명과 Gatekeeper를 확인한 뒤 최종 ZIP, `SHA256SUMS`, `release-manifest.json`을 만든다. 배포 ZIP을 다시 만들거나 교체하지 않는다.

1. 검증한 커밋에 `v<version>` 태그를 만든다.
2. 변경 내용을 사용자 관점에서 정리하고 GitHub draft release에 위 세 파일을 올린다.
3. 파일과 태그를 대조한 뒤 prerelease가 아닌 정식 Latest로 공개한다.
4. 인증 없이 공개 ZIP을 다시 내려받아 SHA-256, `codesign --verify --deep --strict`, `stapler validate`, `spctl --assess`와 앱 실행을 확인한다.
5. `magicsih/homebrew-tap`에 `Casks/callpath.rb`를 추가하거나 갱신하는 PR을 만든다. URL은 버전이 고정된 공개 ZIP, SHA-256은 실제 다운로드한 파일의 값이다. `app "Callpath.app"`, `depends_on macos: :ventura`를 사용한다.
6. cask style과 온라인 audit을 통과하고 병합한 뒤 실제 Homebrew 설치와 앱 실행을 확인한다. Gatekeeper와 quarantine을 끄지 않는다. 사용자 데이터를 지우는 zap은 추가하지 않는다.

설치 명령은 `brew install --cask magicsih/tap/callpath`다. 새 버전은 `brew update` 후 `brew upgrade --cask callpath`로 갱신한다. 앱 자체 자동 업데이트는 제공하지 않는다.

원본 로그, 화면과 패키지는 NAS1dual의 작업별 증적 폴더로 복사하고 직접 읽은 SHA-256을 대조한 뒤 로컬 원본을 정리한다. Git에는 소스와 검증 결과 요약만 남긴다.
