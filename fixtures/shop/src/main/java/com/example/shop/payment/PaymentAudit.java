package com.example.shop.payment;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class PaymentAudit {
    private final List<String> lines = new ArrayList<>();

    public void record(long customerId, long amount, PaymentResult result) {
        String line = customerId + "," + amount + "," + result.approved();
        lines.add(line);
    }
}
