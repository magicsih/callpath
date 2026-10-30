package com.example.shop.order;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface OrderRepository extends JpaRepository<Order, Long> {
    @Query("select o.customerId from Order o where o.status = 'PENDING'")
    List<Long> findUnpaidCustomerIds();
}
