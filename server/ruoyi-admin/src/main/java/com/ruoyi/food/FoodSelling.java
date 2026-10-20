package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import java.time.*;
import java.util.*;

public final class FoodSelling {
  private FoodSelling() {}

  public static LocalDateTime now() {
    return LocalDateTime.now(FoodReservations.ZONE);
  }

  public static LocalDateTime time(Object value) {
    return value == null ? null : LocalDateTime.parse(value.toString().replace(' ', 'T'));
  }

  public static String unavailable(Map<String, Object> p, LocalDateTime when) {
    if (number(p, "active") != 1) return "菜品已下架";
    if (p.get("sold_out") != null
        && number(p, "sold_out") == 1
        && (p.get("sold_out_until") == null || when.isBefore(time(p.get("sold_out_until")))))
      return "菜品暂时售罄";
    if (!FoodBusinessRules.isOpen(
        Map.of(
            "active",
            1,
            "business_periods",
            text(p, "sale_periods"),
            "open_time",
            "",
            "close_time",
            ""),
        when.toLocalTime())) return "未到售卖时段";
    return "";
  }

  public static void requireAvailable(Map<String, Object> p, LocalDateTime when) {
    String reason = unavailable(p, when);
    require(reason.isEmpty(), text(p, "name") + "：" + reason);
  }

  public static void decorate(Map<String, Object> p, LocalDateTime when) {
    String reason = unavailable(p, when);
    p.put("available", reason.isEmpty());
    p.put("unavailable_reason", reason);
    if (!reason.isEmpty()) p.put("stock", 0);
  }
}
