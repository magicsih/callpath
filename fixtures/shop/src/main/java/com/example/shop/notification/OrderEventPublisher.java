package com.example.shop.notification;

import com.example.shop.order.Order;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class OrderEventPublisher {
    private final KafkaTemplate<String, String> kafka;

    public OrderEventPublisher(KafkaTemplate<String, String> kafka) {
        this.kafka = kafka;
    }

    public void publishPlaced(Order order) {
        String payload = order.getId() + ":" + order.getAmount();
        kafka.send("order-placed", payload);
    }
}
