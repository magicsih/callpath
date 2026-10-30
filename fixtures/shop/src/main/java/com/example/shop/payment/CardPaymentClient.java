package com.example.shop.payment;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class CardPaymentClient implements PaymentClient {
    private final RestClient http;
    private final PaymentAudit audit;

    public CardPaymentClient(RestClient http, PaymentAudit audit) {
        this.http = http;
        this.audit = audit;
    }

    @Override
    public PaymentResult approve(long customerId, long amount) {
        CardApproval body = new CardApproval(customerId, amount);
        PaymentResult result = http.post().uri("/card/approve").body(body).retrieve().body(PaymentResult.class);
        audit.record(customerId, amount, result);
        return result;
    }
}
