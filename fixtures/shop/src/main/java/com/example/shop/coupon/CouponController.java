package com.example.shop.coupon;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/coupons")
public class CouponController {
    private final CouponCalculator calculator;

    public CouponController(CouponCalculator calculator) {
        this.calculator = calculator;
    }

    @GetMapping("/{code}")
    public Coupon get(@PathVariable String code) {
        return calculator.find(code);
    }
}
