package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class FoodKitchen {
  private final JdbcTemplate db;

  public FoodKitchen(JdbcTemplate db) {
    this.db = db;
  }

  public List<Map<String, Object>> queue(long store) {
    var config =
        db.queryForMap("SELECT kitchen_capacity,cooking_minutes FROM food_store WHERE id=?", store);
    // A 0/negative capacity would empty the lane queue and throw on the next remove().
    int capacity = Math.max(1, (int) number(config, "kitchen_capacity")),
        minutes = Math.max(1, (int) number(config, "cooking_minutes"));
    var now = FoodSelling.now();
    var lanes = new PriorityQueue<LocalDateTime>();
    for (int i = 0; i < capacity; i++) lanes.add(now);
    var rows =
        db.queryForList(
            "SELECT o.*,s.name store_name FROM food_order o JOIN food_store s ON s.id=o.store_id"
                + " WHERE o.store_id=? AND o.status IN ('PENDING','PREPARING') AND"
                + " o.refund_status<>'REQUESTED' ORDER BY (o.status='PREPARING')"
                + " DESC,COALESCE(o.prepare_at,o.paid_at),o.paid_at,o.id",
            store);
    Map<String, List<Map<String, Object>>> items = new HashMap<>();
    for (var item :
        db.queryForList(
            "SELECT i.* FROM food_order_item i JOIN food_order o ON o.id=i.order_id WHERE"
                + " o.store_id=? AND o.status IN ('PENDING','PREPARING') AND"
                + " o.refund_status<>'REQUESTED' AND i.quantity>i.refunded_quantity ORDER BY i.id",
            store)) items.computeIfAbsent(text(item, "order_id"), k -> new ArrayList<>()).add(item);
    int ahead = 0;
    for (var o : rows) {
      var available = lanes.remove();
      var due = FoodSelling.time(o.get("prepare_at"));
      var start = available;
      if (due != null && due.isAfter(start)) start = due;
      var finish = start.plusMinutes(minutes);
      if ("PREPARING".equals(o.get("status"))) {
        var began = FoodSelling.time(o.get("preparing_at"));
        if (began != null) finish = began.plusMinutes(minutes);
        if (finish.isBefore(now)) finish = now.plusMinutes(1);
        if (finish.isBefore(available)) finish = available.plusMinutes(1);
      }
      o.put("items", items.getOrDefault(text(o, "id"), List.of()));
      lanes.add(finish);
      var estimate = new LinkedHashMap<String, Object>();
      estimate.put("ahead", ahead++);
      estimate.put("estimatedReadyAt", finish.withNano(0));
      estimate.put("minutes", Math.max(1, (ChronoUnit.SECONDS.between(now, finish) + 59) / 60));
      estimate.put("waitingForSchedule", due != null && due.isAfter(now));
      var promised = FoodSelling.time(o.get("promised_ready_at"));
      estimate.put("overdue", promised != null && now.isAfter(promised));
      estimate.put(
          "overdueMinutes",
          promised == null ? 0 : Math.max(0, ChronoUnit.MINUTES.between(promised, now)));
      o.put("queue", estimate);
    }
    return rows;
  }

  public void attach(Map<String, Object> order) {
    if (!Set.of("PENDING", "PREPARING").contains(text(order, "status"))
        || "REQUESTED".equals(order.get("refund_status"))) return;
    var estimate = estimate(number(order, "store_id"), text(order, "id"));
    if (estimate != null) order.put("queue", estimate);
  }

  /**
   * Estimates one order by walking the queue only until that order is reached.
   *
   * <p>The previous implementation rebuilt the whole store queue for every detail view: an extra
   * join on food_store, a second query loading every pending item, and an estimate object for each
   * following order. The merchant detail page polls every 15 seconds, so the cost grew with the
   * backlog even though only one order's numbers were displayed. The lane simulation below is
   * intentionally identical to {@link #queue(long)} so both views report the same numbers.
   */
  private Map<String, Object> estimate(long store, String id) {
    var configs =
        db.queryForList(
            "SELECT kitchen_capacity,cooking_minutes FROM food_store WHERE id=?", store);
    if (configs.isEmpty()) return null;
    var config = configs.get(0);
    int capacity = Math.max(1, (int) number(config, "kitchen_capacity")),
        minutes = Math.max(1, (int) number(config, "cooking_minutes"));
    var now = FoodSelling.now();
    var lanes = new PriorityQueue<LocalDateTime>();
    for (int i = 0; i < capacity; i++) lanes.add(now);
    var rows =
        db.queryForList(
            "SELECT id,status,prepare_at,preparing_at,paid_at,promised_ready_at FROM food_order"
                + " WHERE store_id=? AND status IN ('PENDING','PREPARING') AND"
                + " refund_status<>'REQUESTED' ORDER BY (status='PREPARING')"
                + " DESC,COALESCE(prepare_at,paid_at),paid_at,id",
            store);
    int ahead = 0;
    for (var o : rows) {
      var available = lanes.remove();
      var due = FoodSelling.time(o.get("prepare_at"));
      var start = available;
      if (due != null && due.isAfter(start)) start = due;
      var finish = start.plusMinutes(minutes);
      if ("PREPARING".equals(o.get("status"))) {
        var began = FoodSelling.time(o.get("preparing_at"));
        if (began != null) finish = began.plusMinutes(minutes);
        if (finish.isBefore(now)) finish = now.plusMinutes(1);
        if (finish.isBefore(available)) finish = available.plusMinutes(1);
      }
      lanes.add(finish);
      if (id.equals(text(o, "id"))) {
        var estimate = new LinkedHashMap<String, Object>();
        estimate.put("ahead", ahead);
        estimate.put("estimatedReadyAt", finish.withNano(0));
        estimate.put("minutes", Math.max(1, (ChronoUnit.SECONDS.between(now, finish) + 59) / 60));
        estimate.put("waitingForSchedule", due != null && due.isAfter(now));
        var promised = FoodSelling.time(o.get("promised_ready_at"));
        estimate.put("overdue", promised != null && now.isAfter(promised));
        estimate.put(
            "overdueMinutes",
            promised == null ? 0 : Math.max(0, ChronoUnit.MINUTES.between(promised, now)));
        return estimate;
      }
      ahead++;
    }
    return null;
  }

  public void promise(String id, long store) {
    for (var o : queue(store))
      if (o.get("id").equals(id)) {
        var q = (Map<?, ?>) o.get("queue");
        Object due =
            o.get("scheduled_at") == null ? q.get("estimatedReadyAt") : o.get("scheduled_at");
        db.update(
            "UPDATE food_order SET promised_ready_at=? WHERE id=? AND promised_ready_at IS NULL",
            due,
            id);
        break;
      }
  }
}
