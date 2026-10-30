package com.example.shop.notification;

import com.example.shop.order.OrderRepository;
import java.util.List;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class UnpaidReminderJob {
    private final OrderRepository orders;
    private final Notifier notifier;

    public UnpaidReminderJob(OrderRepository orders, Notifier notifier) {
        this.orders = orders;
        this.notifier = notifier;
    }

    @Scheduled(cron = "0 0 9 * * *")
    public void run() {
        List<Long> customerIds = orders.findUnpaidCustomerIds();
        for (Long customerId : customerIds) {
            notifier.remindUnpaid(customerId);
        }
    }
}
