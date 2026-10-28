package shop.order

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class OrderServiceTest {
    private fun newService() = OrderService(PaymentClient(), StockRepository(), OrderRepository(), CouponCalculator())

    @Test
    fun `placeOrder pays total amount`() {
        val request = OrderRequest("o-1", listOf(OrderItem("sku", 1000, 2)), null)
        val result = newService().placeOrder(request)
        assertEquals(2000, result.paidAmount)
    }

    @Test
    fun `placeOrder applies coupon discount`() {
        val request = OrderRequest("o-2", listOf(OrderItem("sku", 1000, 2)), "TEN-OFF")
        val result = newService().placeOrder(request)
        assertEquals(1800, result.paidAmount)
    }
}
