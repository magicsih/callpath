package com.example.shop.order;

import org.springframework.stereotype.Repository;

@Repository
public interface StockRepository {
    int remaining(long productId);

    void update(long productId, int left);
}
