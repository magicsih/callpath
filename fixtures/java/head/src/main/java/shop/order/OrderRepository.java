package shop.order;

public class OrderRepository {
    public OrderResult confirm(OrderRequest request, long paidAmount) {
        return new OrderResult(request.orderId(), paidAmount);
    }
}
