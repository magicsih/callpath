package com.example.shop.notification

fun receiptText(paid: OrderPaid): String = "Order #${paid.orderId} is paid"

fun reminderText(customerId: Long): String {
    val greeting = "Hello $customerId"
    return "$greeting, your order is waiting for payment"
}
