package com.example.shop.payment;

import org.springframework.stereotype.Component;

@Component
public class PointPaymentClient implements PaymentClient {
    private final PointLedger ledger;
    private final PaymentAudit audit;

    public PointPaymentClient(PointLedger ledger, PaymentAudit audit) {
        this.ledger = ledger;
        this.audit = audit;
    }

    @Override
    public PaymentResult approve(long customerId, long amount) {
        long balance = ledger.balanceOf(customerId);
        if (balance < amount) {
            return PaymentResult.declined("not enough points");
        }
        ledger.deduct(customerId, amount);
        PaymentResult result = PaymentResult.ok();
        audit.record(customerId, amount, result);
        return result;
    }
}
