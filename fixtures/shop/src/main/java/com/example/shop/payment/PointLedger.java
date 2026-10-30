package com.example.shop.payment;

import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Repository;

@Repository
public class PointLedger {
    private final Map<Long, Long> balances = new HashMap<>();

    public long balanceOf(long customerId) {
        return balances.getOrDefault(customerId, 0L);
    }

    public void deduct(long customerId, long amount) {
        long left = balanceOf(customerId) - amount;
        balances.put(customerId, left);
    }
}
