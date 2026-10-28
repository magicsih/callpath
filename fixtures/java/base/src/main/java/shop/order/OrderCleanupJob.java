package shop.order;

import org.springframework.scheduling.annotation.Scheduled;

public class OrderCleanupJob {
    private final OrderRepository orderRepository;

    public OrderCleanupJob(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Scheduled(cron = "0 0 * * * *")
    public void run() {
        // remove abandoned orders
    }
}
