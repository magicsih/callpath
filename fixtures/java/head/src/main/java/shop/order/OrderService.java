package shop.order;

public class OrderService {
    private final PaymentClient paymentClient;
    private final StockRepository stockRepository;
    private final OrderRepository orderRepository;
    private final CouponCalculator couponCalculator;

    public OrderService(PaymentClient paymentClient, StockRepository stockRepository, OrderRepository orderRepository,
                        CouponCalculator couponCalculator) {
        this.paymentClient = paymentClient;
        this.stockRepository = stockRepository;
        this.orderRepository = orderRepository;
        this.couponCalculator = couponCalculator;
    }

    public OrderResult placeOrder(OrderRequest request) {
        long amount = request.totalAmount();
        long discount = couponCalculator.validateCoupon(request);
        stockRepository.decrease(request.items());
        long discounted = amount - discount;
        paymentClient.approve(discounted, request.couponCode());
        return orderRepository.confirm(request, discounted);
    }
}
