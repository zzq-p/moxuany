package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import com.ruoyi.common.annotation.Anonymous;
import com.ruoyi.common.annotation.Log;
import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.enums.BusinessType;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class FoodExperienceController {
  private final JdbcTemplate db;
  private final FoodSupport support;
  private final FoodScope scope;
  private final FoodKitchen kitchen;
  private final FoodEvidence evidence;
  private final FoodMerchantAccounts accounts;
  private final FoodOptions options;
  private final FoodMessages messages;

  public FoodExperienceController(
      JdbcTemplate db,
      FoodSupport support,
      FoodScope scope,
      FoodKitchen kitchen,
      FoodEvidence evidence,
      FoodMerchantAccounts accounts,
      FoodOptions options,
      FoodMessages messages) {
    this.db = db;
    this.support = support;
    this.scope = scope;
    this.kitchen = kitchen;
    this.evidence = evidence;
    this.accounts = accounts;
    this.options = options;
    this.messages = messages;
  }

  // Missing or non-numeric body fields used to surface as a raw NumberFormatException (HTTP 500).
  private static long longValue(Object value, String message) {
    try {
      return Long.parseLong(java.util.Objects.toString(value, "").trim());
    } catch (NumberFormatException e) {
      throw new com.ruoyi.common.exception.ServiceException(message);
    }
  }

  private static int intValue(Object value, String message) {
    try {
      return Integer.parseInt(java.util.Objects.toString(value, "").trim());
    } catch (NumberFormatException e) {
      throw new com.ruoyi.common.exception.ServiceException(message);
    }
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @GetMapping("/food/admin/kitchen")
  public AjaxResult kitchen(@RequestParam long storeId) {
    scope.store(storeId);
    return AjaxResult.success(
        kitchen.queue(storeId).stream().map(FoodOrders::merchantView).toList());
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @GetMapping("/food/admin/staff")
  public AjaxResult staff(@RequestParam long storeId) {
    scope.permit(storeId, "STAFF");
    return AjaxResult.success(
        db.queryForList(
            "SELECT su.user_id,su.staff_role,su.active,u.user_name,u.nick_name FROM food_store_user"
                + " su JOIN sys_user u ON u.user_id=su.user_id WHERE su.store_id=? ORDER BY"
                + " su.user_id",
            storeId));
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @PostMapping("/food/admin/staff")
  public AjaxResult staff(@RequestBody Map<String, Object> b) {
    accounts.createStaff(
        Long.parseLong(text(b, "storeId")),
        text(b, "username"),
        text(b, "password"),
        text(b, "name"),
        text(b, "role"));
    return AjaxResult.success();
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @PostMapping("/food/admin/staff/{user}")
  public AjaxResult staff(@PathVariable long user, @RequestBody Map<String, Object> b) {
    accounts.updateStaff(
        longValue(b.get("storeId"), "请选择商家"),
        user,
        text(b, "role"),
        intValue(b.get("active"), "请选择启用状态"));
    return AjaxResult.success();
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @GetMapping("/food/admin/staff-audit")
  public AjaxResult audit(@RequestParam long storeId, @RequestParam(defaultValue = "1") int page) {
    scope.permit(storeId, "STAFF");
    require(page >= 1 && page <= 10000, "页码无效");
    return AjaxResult.success(
        db.queryForList(
            "SELECT * FROM food_staff_audit WHERE store_id=? ORDER BY id DESC LIMIT 30 OFFSET ?",
            storeId,
            (page - 1) * 30));
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @PostMapping("/food/admin/products/{id}/selling")
  @Log(title = "菜品分时与售罄", businessType = BusinessType.UPDATE)
  public AjaxResult selling(@PathVariable long id, @RequestBody Map<String, Object> b) {
    var productStores =
        db.queryForList("SELECT store_id FROM food_product WHERE id=?", Long.class, id);
    require(!productStores.isEmpty(), "菜品不存在，请刷新列表");
    long store = productStores.get(0);
    scope.permit(store, "CATALOG");
    String periods = text(b, "periods").replace(" ", "");
    require(periods.length() <= 200, "售卖时段过长");
    FoodBusinessRules.validatePeriods(periods);
    boolean sold = Boolean.TRUE.equals(b.get("soldOut"));
    java.time.LocalDateTime until = null;
    if (sold) {
      try {
        if (!text(b, "until").isBlank()) until = FoodSelling.time(b.get("until"));
      } catch (Exception e) {
        throw new com.ruoyi.common.exception.ServiceException("恢复时间格式不正确");
      }
      require(until == null || until.isAfter(FoodSelling.now()), "自动恢复时间必须晚于现在");
    }
    require(
        db.update(
                "UPDATE food_product SET"
                    + " sale_periods=?,sold_out=?,sold_out_until=?,version=version+1 WHERE id=? AND"
                    + " version=?",
                periods,
                sold ? 1 : 0,
                until,
                id,
                longValue(b.get("version"), "菜品数据已变化，请刷新后重试"))
            == 1,
        "菜品已变化，请刷新后再操作");
    scope.audit(
        store,
        "SELLING",
        Long.toString(id),
        sold ? "设为售罄，恢复时间：" + Objects.toString(until, "手动恢复") : "售卖时段：" + periods);
    support.invalidate(store);
    return AjaxResult.success();
  }

  @Anonymous
  @PostMapping("/food/app/orders/{id}/evidence")
  public AjaxResult upload(
      @PathVariable String id, @RequestParam MultipartFile file, HttpServletRequest r) {
    long member = support.member(r);
    support.limit("evidence:" + member, 12, 3600);
    return AjaxResult.success(Map.of("id", evidence.save(member, id, file)));
  }

  @Anonymous
  @GetMapping("/food/app/evidence/{id}")
  public AjaxResult evidence(@PathVariable String id, HttpServletRequest r) {
    long member = support.member(r);
    var row = evidence.metadata(id);
    require(number(row, "member_id") == member, "无权查看凭证");
    return AjaxResult.success((Object) evidence.image(row));
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @GetMapping("/food/admin/evidence/{id}")
  public AjaxResult adminEvidence(@PathVariable String id) {
    var row = evidence.metadata(id);
    scope.permitOrder(text(row, "order_id"), "REFUND");
    return AjaxResult.success((Object) evidence.image(row));
  }

  @Anonymous
  @GetMapping("/food/app/favorites")
  public AjaxResult favorites(HttpServletRequest r) {
    long member = support.member(r);
    var stores =
        db.queryForList(
            "SELECT s.*,f.created_at favorited_at FROM food_favorite f JOIN food_store s ON"
                + " s.id=f.target_id WHERE f.member_id=? AND f.kind='STORE' ORDER BY f.created_at"
                + " DESC",
            member);
    var products =
        db.queryForList(
            "SELECT p.*,s.name store_name,s.active store_active FROM food_favorite f JOIN"
                + " food_product p ON p.id=f.target_id JOIN food_store s ON s.id=p.store_id WHERE"
                + " f.member_id=? AND f.kind='PRODUCT' ORDER BY f.created_at DESC",
            member);
    products.forEach(p -> FoodSelling.decorate(p, FoodSelling.now()));
    return AjaxResult.success(Map.of("stores", stores, "products", products));
  }

  @Anonymous
  @PostMapping("/food/app/favorites")
  public AjaxResult favorite(@RequestBody Map<String, Object> b, HttpServletRequest r) {
    long member = support.member(r);
    String kind = text(b, "kind");
    require(Set.of("STORE", "PRODUCT").contains(kind), "收藏类型无效");
    long target = Long.parseLong(text(b, "id"));
    if (Boolean.TRUE.equals(b.get("favorite"))) {
      require(
          db.queryForObject(
                  "SELECT COUNT(*) FROM "
                      + (kind.equals("STORE") ? "food_store" : "food_product")
                      + " WHERE id=?",
                  Integer.class,
                  target)
              == 1,
          "收藏对象不存在");
      require(
          db.queryForObject(
                  "SELECT COUNT(*) FROM food_favorite WHERE member_id=?", Integer.class, member)
              < 200,
          "最多收藏200个店铺或菜品");
      db.update(
          "INSERT IGNORE INTO food_favorite(member_id,kind,target_id) VALUES(?,?,?)",
          member,
          kind,
          target);
    } else
      db.update(
          "DELETE FROM food_favorite WHERE member_id=? AND kind=? AND target_id=?",
          member,
          kind,
          target);
    return AjaxResult.success();
  }

  @Anonymous
  @GetMapping("/food/app/orders/{id}/reorder")
  public AjaxResult reorder(@PathVariable String id, HttpServletRequest r) {
    long member = support.member(r);
    var orders =
        db.queryForList(
            "SELECT o.* FROM food_order o JOIN food_store s ON s.id=o.store_id WHERE o.id=? AND"
                + " o.member_id=? AND s.active=1",
            id,
            member);
    require(!orders.isEmpty(), "订单不存在或店铺休息中");
    var old = db.queryForList("SELECT * FROM food_order_item WHERE order_id=? ORDER BY id", id);
    List<Map<String, Object>> products =
        db.queryForList(
            "SELECT * FROM food_product WHERE store_id=? AND id IN (SELECT product_id FROM"
                + " food_order_item WHERE order_id=?)",
            orders.get(0).get("store_id"),
            id);
    options.attach(products);
    products.forEach(p -> FoodSelling.decorate(p, FoodSelling.now()));
    for (var item : old) {
      List<Long> addons = new ArrayList<>();
      Long spec = null;
      for (String key : text(item, "option_ids").split(",")) {
        if (key.isEmpty()) continue;
        var option =
            db.queryForList("SELECT kind FROM food_product_option WHERE id=?", Long.parseLong(key));
        if (!option.isEmpty() && "SPEC".equals(option.get(0).get("kind")))
          spec = Long.parseLong(key);
        else addons.add(Long.parseLong(key));
      }
      item.put("id", item.get("product_id"));
      item.put("specId", spec);
      item.put("addonIds", addons);
    }
    return AjaxResult.success(
        Map.of("storeId", orders.get(0).get("store_id"), "items", old, "products", products));
  }

  @Anonymous
  @GetMapping("/food/app/subscriptions")
  public AjaxResult templates() {
    return AjaxResult.success(messages.publicTemplates());
  }

  @Anonymous
  @PostMapping("/food/app/orders/{id}/subscriptions")
  public AjaxResult subscribe(
      @PathVariable String id, @RequestBody Map<String, String> choices, HttpServletRequest r) {
    long member = support.member(r);
    support.limit("subscribe:" + member, 20, 60);
    messages.subscribe(member, id, choices);
    return AjaxResult.success();
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @GetMapping("/food/admin/messages")
  public AjaxResult messages() {
    scope.platformOnly();
    return AjaxResult.success(
        Map.of(
            "configured",
            messages.configured(),
            "templates",
            messages.templates(),
            "logs",
            db.queryForList(
                "SELECT id,order_id,event,status,attempts,last_error,created_at,sent_at FROM"
                    + " food_message ORDER BY id DESC LIMIT 100")));
  }

  @PreAuthorize("@ss.hasPermi('food:manage')")
  @PostMapping("/food/admin/messages/{event}")
  @Log(title = "微信消息模板", businessType = BusinessType.UPDATE)
  public AjaxResult template(@PathVariable String event, @RequestBody Map<String, Object> b) {
    scope.platformOnly();
    messages.save(event, b);
    return AjaxResult.success();
  }
}
