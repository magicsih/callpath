package com.example.shop.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
@EnableConfigurationProperties(ShopProperties.class)
public class ShopConfig {
    @Bean
    public RestClient paymentRestClient(ShopProperties properties) {
        return RestClient.builder().baseUrl(properties.getPaymentUrl()).build();
    }
}
