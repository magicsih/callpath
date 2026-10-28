package shop.order;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OrderServiceTest {
    @Test
    void placeOrderPaysTotalAmount() {
        OrderService service = new OrderService(new PaymentClient(), new StockRepository(), new OrderRepository());
        OrderRequest request = new OrderRequest("o-1", List.of(new OrderItem("sku", 1000, 2)), null);
        OrderResult result = service.placeOrder(request);
        assertEquals(2000, result.paidAmount());
    }
}
