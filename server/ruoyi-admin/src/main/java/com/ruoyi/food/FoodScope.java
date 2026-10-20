package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import com.ruoyi.common.utils.SecurityUtils;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** All merchant scope is derived from the authenticated RuoYi user, never from request claims. */
@Component
public class FoodScope {
  private final JdbcTemplate db;

  public FoodScope(JdbcTemplate db) {
    this.db = db;
  }

  public boolean platform() {
    return SecurityUtils.isAdmin();
  }

  public void platformOnly() {
    require(platform(), "仅总后台可操作");
  }

  public String condition(String storeColumn) {
    return platform()
        ? "1=1"
        : storeColumn
            + " IN (SELECT store_id FROM food_store_user WHERE active=1 AND user_id="
            + SecurityUtils.getUserId()
            + ")";
  }

  public boolean allowed(long store, String capability) {
    if (platform()) return true;
    var roles =
        db.queryForList(
            "SELECT staff_role FROM food_store_user WHERE store_id=? AND user_id=? AND active=1",
            String.class,
            store,
            SecurityUtils.getUserId());
    return roles.stream()
        .anyMatch(
            r ->
                r.equals("MANAGER")
                    || capability.equals("READ")
                    || r.equals("CLERK")
                        && java.util.Set.of("ORDER", "PICKUP", "REPLY").contains(capability)
                    || r.equals("KITCHEN") && capability.equals("COOK"));
  }

  public void permit(long store, String capability) {
    store(store);
    require(allowed(store, capability), "当前员工岗位无权执行此操作");
  }

  public long permitOrder(String id, String capability) {
    order(id);
    long store = db.queryForObject("SELECT store_id FROM food_order WHERE id=?", Long.class, id);
    permit(store, capability);
    return store;
  }

  public java.util.List<java.util.Map<String, Object>> permissions() {
    return platform()
        ? java.util.List.of()
        : db.queryForList(
            "SELECT store_id,staff_role FROM food_store_user WHERE user_id=? AND active=1",
            SecurityUtils.getUserId());
  }

  public void managerOnly() {
    if (!platform())
      require(
          db.queryForObject(
                      "SELECT COUNT(*) FROM food_store_user WHERE user_id=? AND active=1 AND"
                          + " staff_role<>'MANAGER'",
                      Integer.class,
                      SecurityUtils.getUserId())
                  == 0
              && !permissions().isEmpty(),
          "仅店长可查看经营数据");
  }

  public void audit(long store, String action, String target, String note) {
    db.update(
        "INSERT INTO food_staff_audit(store_id,actor_id,actor_name,action,target,note)"
            + " VALUES(?,?,?,?,?,?)",
        store,
        SecurityUtils.getUserId(),
        SecurityUtils.getUsername(),
        action,
        target,
        note);
  }

  public void store(long id) {
    require(
        db.queryForObject(
                "SELECT COUNT(*) FROM food_store WHERE id=? AND " + condition("id"),
                Integer.class,
                id)
            == 1,
        "商家不存在或无权访问");
  }

  public void order(String id) {
    require(
        db.queryForObject(
                "SELECT COUNT(*) FROM food_order WHERE id=? AND " + condition("store_id"),
                Integer.class,
                id)
            == 1,
        "订单不存在或无权访问");
  }
}
