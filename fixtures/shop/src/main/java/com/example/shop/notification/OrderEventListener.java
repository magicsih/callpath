package com.example.shop.notification;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventListener {
    private final Notifier notifier;

    public OrderEventListener(Notifier notifier) {
        this.notifier = notifier;
    }

    @KafkaListener(topics = "order-paid", groupId = "shop")
    public void onPaid(String message) {
        String[] parts = message.split(":");
        notifier.sendReceipt(Long.parseLong(parts[0]), Long.parseLong(parts[1]));
    }
}
