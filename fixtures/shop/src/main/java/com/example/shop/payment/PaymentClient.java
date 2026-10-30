package com.example.shop.payment;

public interface PaymentClient {
    PaymentResult approve(long customerId, long amount);
}
