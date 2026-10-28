package shop.order

class OrderRepository {
    fun confirm(request: OrderRequest, paidAmount: Long): OrderResult = OrderResult(request.orderId, paidAmount)
}
