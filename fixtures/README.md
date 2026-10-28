# fixtures

설계 문서 1.2절의 쿠폰 예시를 Java와 Kotlin으로 재현한 표본 저장소. `base/`와 `head/`는 같은 저장소의 두 시점이다. 테스트 계획의 인수조건 A1~A4가 이 디렉터리를 사용한다.

핵심 변경: `OrderService.placeOrder`에서 `approve → decrease` 순서가 `validateCoupon → decrease → approve`로 바뀌어 재고 차감이 결제 승인 앞으로 이동했다.
