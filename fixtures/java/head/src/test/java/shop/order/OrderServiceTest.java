package shop.order;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OrderServiceTest {
    private OrderService newService() {
        return new OrderService(new PaymentClient(), new StockRepository(), new OrderRepository(), new CouponCalculator());
    }

    @Test
    void placeOrderPaysTotalAmount() {
        OrderRequest request = new OrderRequest("o-1", List.of(new OrderItem("sku", 1000, 2)), null);
        OrderResult result = newService().placeOrder(request);
        assertEquals(2000, result.paidAmount());
    }

    @Test
    void placeOrderAppliesCouponDiscount() {
        OrderRequest request = new OrderRequest("o-2", List.of(new OrderItem("sku", 1000, 2)), "TEN-OFF");
        OrderResult result = newService().placeOrder(request);
        assertEquals(1800, result.paidAmount());
    }
}
