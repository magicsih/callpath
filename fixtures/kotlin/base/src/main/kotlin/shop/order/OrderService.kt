package shop.order

class OrderService(
    private val paymentClient: PaymentClient,
    private val stockRepository: StockRepository,
    private val orderRepository: OrderRepository,
) {
    fun placeOrder(request: OrderRequest): OrderResult {
        val amount = request.totalAmount()
        paymentClient.approve(amount)
        stockRepository.decrease(request.items)
        return orderRepository.confirm(request, amount)
    }
}
