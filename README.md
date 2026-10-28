# codereview

AI가 한 번에 고쳐 올린 PR을 파일 순서가 아니라 호출 흐름 순서로 읽는 데스크톱 리뷰 앱. 진입점부터 변경 메서드를 따라가고, 메서드 안의 호출 순서가 바뀐 곳을 표시하고, 테스트 코드는 토글로 분리해 본다. Java, Kotlin이 1차 대상이다.

- 설계: [docs/design/2026-10-28-flow-review/README.md](docs/design/2026-10-28-flow-review/README.md)
- 테스트 계획: [docs/design/2026-10-28-flow-review/test-plan.md](docs/design/2026-10-28-flow-review/test-plan.md)
- 결정 기록: [docs/design/2026-10-28-flow-review/decisions.md](docs/design/2026-10-28-flow-review/decisions.md)
