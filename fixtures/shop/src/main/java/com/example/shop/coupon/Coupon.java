package com.example.shop.coupon;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.LocalDate;

@Entity
public class Coupon {
    @Id
    private String code;
    private long rate;
    private long maxDiscount;
    private LocalDate expiresAt;

    public String getCode() {
        return code;
    }

    public boolean isExpired() {
        return expiresAt.isBefore(LocalDate.now());
    }

    public long discountFor(long amount) {
        long discount = amount * rate / 100;
        return Math.min(discount, maxDiscount);
    }
}
