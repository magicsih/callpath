package com.example.shop.coupon;

import org.springframework.stereotype.Service;

@Service
public class CouponCalculator {
    private final CouponRepository coupons;

    public CouponCalculator(CouponRepository coupons) {
        this.coupons = coupons;
    }

    public long validateCoupon(String code, long amount) {
        if (code == null) {
            return 0;
        }
        Coupon coupon = find(code);
        if (coupon.isExpired()) {
            throw new IllegalStateException("expired coupon: " + code);
        }
        return coupon.discountFor(amount);
    }

    public Coupon find(String code) {
        return coupons.findByCode(code).orElseThrow(() -> new IllegalArgumentException("unknown coupon: " + code));
    }
}
