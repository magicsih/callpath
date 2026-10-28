package shop.order;

import java.util.List;

public record OrderRequest(String orderId, List<OrderItem> items, String couponCode) {
    public long totalAmount() {
        return items.stream().mapToLong(i -> i.price() * i.quantity()).sum();
    }
}
