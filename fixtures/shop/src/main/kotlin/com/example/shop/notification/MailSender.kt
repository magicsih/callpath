package com.example.shop.notification

interface MailSender {
    fun send(customerId: Long, text: String)
}
