package shop.order;

public class CouponCalculator {
    public long validateCoupon(OrderRequest request) {
        if (request.couponCode() == null) {
            return 0;
        }
        int quantity = request.items().stream().mapToInt(OrderItem::quantity).sum();
        if (quantity == 0) {
            return 0;
        }
        return discountFor(request.couponCode(), request.totalAmount());
    }

    long discountFor(String couponCode, long amount) {
        return couponCode.startsWith("TEN") ? amount / 10 : 0;
    }
}
