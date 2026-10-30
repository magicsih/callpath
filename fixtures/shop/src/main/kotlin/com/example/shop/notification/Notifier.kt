package com.example.shop.notification

import org.springframework.stereotype.Service

@Service
class Notifier(private val mail: MailSender) {
    fun sendReceipt(orderId: Long, customerId: Long) {
        val paid = OrderPaid(orderId, customerId)
        val text = receiptText(paid)
        mail.send(customerId, text)
    }

    fun remindUnpaid(customerId: Long) {
        mail.send(customerId, reminderText(customerId))
    }
}
