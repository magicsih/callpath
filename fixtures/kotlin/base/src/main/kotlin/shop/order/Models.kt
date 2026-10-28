package shop.order

data class OrderItem(val sku: String, val price: Long, val quantity: Int)

data class OrderRequest(val orderId: String, val items: List<OrderItem>, val couponCode: String?) {
    fun totalAmount(): Long = items.sumOf { it.price * it.quantity }
}

data class OrderResult(val orderId: String, val paidAmount: Long)
