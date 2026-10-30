package com.example.shop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("shop")
public class ShopProperties {
    private String paymentUrl;

    public String getPaymentUrl() {
        return paymentUrl;
    }

    public void setPaymentUrl(String paymentUrl) {
        this.paymentUrl = paymentUrl;
    }
}
