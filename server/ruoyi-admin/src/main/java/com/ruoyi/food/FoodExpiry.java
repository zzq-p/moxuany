package com.ruoyi.food;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration
@EnableScheduling
public class FoodExpiry {
  private static final Logger log = LoggerFactory.getLogger(FoodExpiry.class);
  private final JdbcTemplate db;
  private final FoodExpiryWorker worker;

  public FoodExpiry(JdbcTemplate db, FoodExpiryWorker worker) {
    this.db = db;
    this.worker = worker;
  }

  @Scheduled(fixedDelayString = "${food.expiry-delay-ms:1000}")
  public void expire() {
    long deadline = System.nanoTime() + 800_000_000L;
    int count = 0;
    while (count < 500 && System.nanoTime() < deadline) {
      try {
        if (!worker.one()) break;
        count++;
      } catch (FoodExpiryWorker.Failure e) {
        db.update(
            "UPDATE food_order SET expiry_retry_at=DATE_ADD(NOW(),INTERVAL 60 SECOND) WHERE id=?"
                + " AND status='UNPAID'",
            e.id);
        log.warn("Expiry deferred order {} after rollback", e.id, e);
      } catch (Exception e) {
        log.warn("Expiry worker unavailable; retry next tick", e);
        break;
      }
    }
    if (count > 0) log.info("Expired {} unpaid orders", count);
  }
}
