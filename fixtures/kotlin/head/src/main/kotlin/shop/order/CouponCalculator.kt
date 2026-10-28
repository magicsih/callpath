package shop.order

class CouponCalculator {
    fun validateCoupon(request: OrderRequest): Long {
        val code = request.couponCode ?: return 0
        val quantity = request.items.sumOf { it.quantity }
        if (quantity == 0) return 0
        return discountFor(code, request.totalAmount())
    }

    internal fun discountFor(couponCode: String, amount: Long): Long =
        if (couponCode.startsWith("TEN")) amount / 10 else 0
}
