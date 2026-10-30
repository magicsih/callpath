# fixtures/shop

7단계 새 저장소 안내자(설계 [2026-10-30-repo-guide](../../docs/design/2026-10-30-repo-guide/README.md))의 표본. 비교가 아니라 한 시점의 저장소라서 `base/`, `head/` 없이 저장소 모양 그대로 둔다. 테스트 계획의 인수조건 B1~B5가 이 디렉터리를 사용한다.

- 패키지: 루트(`ShopApplication`)와 `order`, `coupon`, `payment`, `notification`, `config`
- 진입점: HTTP 3개(`POST /orders`, `GET /orders/{id}`, `GET /coupons/{code}`), Kafka 리스너, `@Scheduled`, `main`
- `PaymentClient` 인터페이스와 구현 두 개(`CardPaymentClient`, `PointPaymentClient`), 두 구현이 함께 부르는 `PaymentAudit.record`
- getter, setter, 한 줄 위임(`CouponCalculator.find`), Java record, enum, Kotlin data class, Kotlin 최상위 함수 파일(`ReceiptText.kt`)
- 생성 코드: `src/main/generated` 아래 파일과 `@Generated`가 붙은 `QOrder`는 지도에서 빠져야 한다
- 테스트: `OrderServiceTest`, `ReceiptTextTest`
