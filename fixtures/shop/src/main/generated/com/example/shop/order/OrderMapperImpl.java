package com.example.shop.order;

public class OrderMapperImpl {
    public OrderResult toResult(Order order) {
        long id = order.getId();
        return new OrderResult(id, order.getAmount());
    }
}
