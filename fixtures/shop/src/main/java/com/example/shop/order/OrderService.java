package com.example.shop.order;

import com.example.shop.coupon.CouponCalculator;
import com.example.shop.notification.OrderEventPublisher;
import com.example.shop.payment.PaymentClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {
    private final CouponCalculator coupons;
    private final StockService stock;
    private final PaymentClient payment;
    private final OrderRepository orders;
    private final OrderEventPublisher events;

    public OrderService(CouponCalculator coupons, StockService stock, PaymentClient payment, OrderRepository orders, OrderEventPublisher events) {
        this.coupons = coupons;
        this.stock = stock;
        this.payment = payment;
        this.orders = orders;
        this.events = events;
    }

    @Transactional
    public OrderResult placeOrder(OrderRequest request) {
        long amount = request.totalAmount();
        long discount = coupons.validateCoupon(request.couponCode(), amount);
        stock.decrease(request.items());
        payment.approve(request.customerId(), amount - discount);
        Order order = orders.save(new Order(request.customerId(), amount - discount));
        events.publishPlaced(order);
        return new OrderResult(order.getId(), order.getAmount());
    }

    public Order find(long id) {
        return orders.findById(id).orElseThrow();
    }
}
