package com.example.shop.order;

import javax.annotation.processing.Generated;

@Generated("com.querydsl.codegen.DefaultEntitySerializer")
public class QOrder {
    public static final QOrder order = new QOrder("order");

    public QOrder(String variable) {
        init(variable);
    }

    private void init(String variable) {
        System.out.println(variable);
        System.out.println(variable.length());
    }
}
