package com.example.shop.order;

import java.util.List;
import org.junit.jupiter.api.Test;

class OrderServiceTest {
    private final OrderService service = new OrderService(null, null, null, null, null);

    @Test
    void placesOrder() {
        service.placeOrder(new OrderRequest(1L, null, List.of()));
    }

    @Test
    void findsOrder() {
        service.find(1L);
    }
}
