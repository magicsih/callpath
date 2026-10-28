package shop.order

import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

@RestController
class OrderController(private val orderService: OrderService) {
    @PostMapping("/orders")
    fun place(@RequestBody request: OrderRequest): OrderResult = orderService.placeOrder(request)
}
