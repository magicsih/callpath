package shop.order

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class OrderServiceTest {
    @Test
    fun `placeOrder pays total amount`() {
        val service = OrderService(PaymentClient(), StockRepository(), OrderRepository())
        val request = OrderRequest("o-1", listOf(OrderItem("sku", 1000, 2)), null)
        val result = service.placeOrder(request)
        assertEquals(2000, result.paidAmount)
    }
}
