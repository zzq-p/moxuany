package com.ruoyi.food;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FoodExpiryWorker {
  private final JdbcTemplate db;
  private final FoodOrders orders;

  public FoodExpiryWorker(JdbcTemplate db, FoodOrders orders) {
    this.db = db;
    this.orders = orders;
  }

  public static class Failure extends RuntimeException {
    public final String id;

    Failure(String id, Exception cause) {
      super(cause);
      this.id = id;
    }
  }

  @Transactional
  public boolean one() {
    var ids =
        db.queryForList(
            "SELECT id FROM food_order WHERE status='UNPAID' AND expires_at<=NOW() AND"
                + " (expiry_retry_at IS NULL OR expiry_retry_at<=NOW()) ORDER BY expires_at,id"
                + " LIMIT 1 FOR UPDATE SKIP LOCKED",
            String.class);
    if (ids.isEmpty()) return false;
    String id = ids.get(0);
    try {
      orders.transition(id, null, "CANCELLED");
      return true;
    } catch (Exception e) {
      throw new Failure(id, e);
    }
  }
}
