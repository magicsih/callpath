package shop.order;

public class OrderService {
    private final PaymentClient paymentClient;
    private final StockRepository stockRepository;
    private final OrderRepository orderRepository;

    public OrderService(PaymentClient paymentClient, StockRepository stockRepository, OrderRepository orderRepository) {
        this.paymentClient = paymentClient;
        this.stockRepository = stockRepository;
        this.orderRepository = orderRepository;
    }

    public OrderResult placeOrder(OrderRequest request) {
        long amount = request.totalAmount();
        paymentClient.approve(amount);
        stockRepository.decrease(request.items());
        return orderRepository.confirm(request, amount);
    }
}
