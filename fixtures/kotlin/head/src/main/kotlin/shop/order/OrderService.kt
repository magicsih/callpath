package shop.order

class OrderService(
    private val paymentClient: PaymentClient,
    private val stockRepository: StockRepository,
    private val orderRepository: OrderRepository,
    private val couponCalculator: CouponCalculator,
) {
    fun placeOrder(request: OrderRequest): OrderResult {
        val amount = request.totalAmount()
        val discount = couponCalculator.validateCoupon(request)
        stockRepository.decrease(request.items)
        val discounted = amount - discount
        paymentClient.approve(discounted, request.couponCode)
        return orderRepository.confirm(request, discounted)
    }
}
