package com.example.shop.order;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;

@Entity
public class Order {
    @Id
    @GeneratedValue
    private Long id;
    private long customerId;
    private long amount;
    private OrderStatus status;

    protected Order() {
    }

    public Order(long customerId, long amount) {
        this.customerId = customerId;
        this.amount = amount;
        this.status = OrderStatus.PENDING;
    }

    public Long getId() {
        return id;
    }

    public long getCustomerId() {
        return customerId;
    }

    public long getAmount() {
        return amount;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public void markPaid() {
        this.status = OrderStatus.PAID;
    }
}
