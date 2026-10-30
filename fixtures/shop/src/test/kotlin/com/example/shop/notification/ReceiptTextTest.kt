package com.example.shop.notification

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ReceiptTextTest {
    @Test
    fun `formats receipt`() {
        assertEquals("Order #1 is paid", receiptText(OrderPaid(1, 2)))
    }
}
