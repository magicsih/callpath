# codereview

AI가 한 번에 고쳐 올린 PR을 파일 순서가 아니라 호출 흐름 순서로 읽는 데스크톱 리뷰 앱. 진입점부터 변경 메서드를 따라가고, 메서드 안의 호출 순서가 바뀐 곳을 표시하고, 테스트 코드는 토글로 분리해 본다. Java, Kotlin이 1차 대상이다.

- 설계: [docs/design/2026-10-28-flow-review/README.md](docs/design/2026-10-28-flow-review/README.md)
- 테스트 계획: [docs/design/2026-10-28-flow-review/test-plan.md](docs/design/2026-10-28-flow-review/test-plan.md)
- 결정 기록: [docs/design/2026-10-28-flow-review/decisions.md](docs/design/2026-10-28-flow-review/decisions.md)

## 구성

| 경로 | 내용 | 상태 |
|---|---|---|
| `packages/core` | 분석 코어와 CLI. diff → 메서드 매핑 → 호출 순서 비교 | 1단계 완료 |
| `fixtures/` | 쿠폰 예시 표본 저장소 (Java, Kotlin) | |
| `packages/lsp`, `packages/providers`, `packages/llm`, `apps/desktop` | 설계 4.1 참고 | 예정 |

## 코어 CLI 사용

```sh
pnpm install
pnpm build

# git 저장소의 두 ref 비교
node packages/core/dist/cli.js analyze <repo> --base origin/main --head HEAD --summary

# 두 디렉터리 비교 (표본)
node packages/core/dist/cli.js analyze --base-dir fixtures/java/base --head-dir fixtures/java/head --summary
```

`--summary`를 빼면 설계 6.1의 `ReviewSession` JSON을 출력한다.

## 개발

```sh
pnpm typecheck
pnpm test
```
