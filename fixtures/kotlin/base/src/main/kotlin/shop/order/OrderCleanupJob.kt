package shop.order

import org.springframework.scheduling.annotation.Scheduled

class OrderCleanupJob(private val orderRepository: OrderRepository) {
    @Scheduled(cron = "0 0 * * * *")
    fun run() {
        // remove abandoned orders
    }
}
