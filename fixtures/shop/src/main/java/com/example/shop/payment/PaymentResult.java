package com.example.shop.payment;

public record PaymentResult(boolean approved, String reason) {
    public static PaymentResult ok() {
        return new PaymentResult(true, null);
    }

    public static PaymentResult declined(String reason) {
        return new PaymentResult(false, reason);
    }
}
