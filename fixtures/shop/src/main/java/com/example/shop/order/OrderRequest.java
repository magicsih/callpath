package com.example.shop.order;

import java.util.List;

public record OrderRequest(long customerId, String couponCode, List<OrderItem> items) {
    public long totalAmount() {
        return items.stream().mapToLong(item -> item.price() * item.quantity()).sum();
    }
}
