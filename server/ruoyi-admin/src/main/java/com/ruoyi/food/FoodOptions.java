package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FoodOptions {
  private final JdbcTemplate db;

  public FoodOptions(JdbcTemplate db) {
    this.db = db;
  }

  public void attach(List<Map<String, Object>> products) {
    if (products.isEmpty()) return;
    Map<Long, List<Map<String, Object>>> groups = new HashMap<>();
    for (var p : products) groups.put(number(p, "id"), new ArrayList<>());
    for (var o :
        db.queryForList(
            "SELECT * FROM food_product_option WHERE active=1 AND product_id IN ("
                + String.join(",", Collections.nCopies(products.size(), "?"))
                + ") ORDER BY id",
            products.stream().map(p -> p.get("id")).toArray()))
      groups.get(number(o, "product_id")).add(o);
    for (var p : products) p.put("options", groups.get(number(p, "id")));
  }

  public List<Map<String, Object>> list(long product) {
    return db.queryForList(
        "SELECT * FROM food_product_option WHERE product_id=? ORDER BY id", product);
  }

  private int integer(Map<String, Object> row, String key, int min, int max) {
    try {
      int v = Integer.parseInt(text(row, key));
      require(v >= min && v <= max, key + "超出范围");
      return v;
    } catch (NumberFormatException e) {
      throw new com.ruoyi.common.exception.ServiceException(key + "须为整数");
    }
  }

  @Transactional
  public void save(long product, List<Map<String, Object>> rows) {
    require(rows != null && rows.size() <= 30, "每道菜最多30个规格或加料");
    require(
        !db.queryForList("SELECT id FROM food_product WHERE id=? FOR UPDATE", product).isEmpty(),
        "菜品不存在");
    Set<Long> ids = new HashSet<>();
    Set<String> names = new HashSet<>();
    for (var r : rows) {
      require(r != null, "配置不能为空");
      String kind = text(r, "kind"), name = text(r, "name").trim();
      require(
          Set.of("SPEC", "ADDON").contains(kind) && !name.isEmpty() && name.length() <= 60,
          "请填写规格类型与名称");
      require(names.add(kind + ":" + name), "同类选项名称不能重复");
      int price = integer(r, "price", kind.equals("SPEC") ? 1 : 0, 1000000),
          stock = integer(r, "stock", 0, 1000000),
          active = integer(r, "active", 0, 1);
      if (r.get("id") == null) {
        db.update(
            "INSERT INTO food_product_option(product_id,kind,name,price,stock,active)"
                + " VALUES(?,?,?,?,?,?)",
            product,
            kind,
            name,
            price,
            stock,
            active);
      } else {
        long id = integer(r, "id", 1, Integer.MAX_VALUE);
        require(ids.add(id), "重复选项编号");
        var old =
            db.queryForList(
                "SELECT kind FROM food_product_option WHERE id=? AND product_id=?", id, product);
        require(!old.isEmpty() && kind.equals(old.get(0).get("kind")), "选项不属于本菜品或类型不可更改");
        require(
            db.update(
                    "UPDATE food_product_option SET"
                        + " name=?,price=?,stock=?,active=?,version=version+1 WHERE id=? AND"
                        + " product_id=? AND version=?",
                    name,
                    price,
                    stock,
                    active,
                    id,
                    product,
                    integer(r, "version", 0, Integer.MAX_VALUE))
                == 1,
            "选项库存已变化，请重新打开配置");
      }
    }
    require(
        db.queryForObject(
                "SELECT COUNT(*) FROM food_product_option WHERE product_id=?",
                Integer.class,
                product)
            <= 30,
        "每道菜最多保留30个规格或加料，请修改已有选项");
    // Explicit active switches replace deletion, so old order snapshots can still restore
    // inventory.
  }
}
