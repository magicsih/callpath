package com.example.shop.order;

import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class StockService {
    private final StockRepository stocks;

    public StockService(StockRepository stocks) {
        this.stocks = stocks;
    }

    public void decrease(List<OrderItem> items) {
        for (OrderItem item : items) {
            int left = stocks.remaining(item.productId());
            if (left < item.quantity()) {
                throw new IllegalStateException("out of stock: " + item.productId());
            }
            stocks.update(item.productId(), left - item.quantity());
        }
    }
}
