package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FoodMemberService {
  private final JdbcTemplate db;

  public FoodMemberService(JdbcTemplate db) {
    this.db = db;
  }

  @Transactional
  public long login(String openid) {
    int created = db.update("INSERT IGNORE INTO food_member(openid) VALUES(?)", openid);
    long id = db.queryForObject("SELECT id FROM food_member WHERE openid=?", Long.class, openid);
    if (created == 1) welcome(id);
    return id;
  }

  public void welcome(long id) {
    db.update(
        "INSERT INTO food_coupon(member_id,title,amount,minimum,expires_at)"
            + " VALUES(?,'新人见面礼',300,1200,DATE_ADD(NOW(),INTERVAL 30 DAY))",
        id);
  }

  @Transactional
  public void checkin(long member) {
    require(
        db.update("INSERT IGNORE INTO food_checkin(member_id,day) VALUES(?,CURRENT_DATE)", member)
            == 1,
        "今天已经签到啦");
    db.update("UPDATE food_member SET points=points+10 WHERE id=?", member);
  }

  @Transactional
  public void redeem(long member) {
    require(
        db.update("UPDATE food_member SET points=points-100 WHERE id=? AND points>=100", member)
            == 1,
        "需要100积分才能兑换");
    db.update(
        "INSERT INTO food_coupon(member_id,title,amount,minimum,expires_at)"
            + " VALUES(?,'积分兑换券',500,2000,DATE_ADD(NOW(),INTERVAL 14 DAY))",
        member);
  }
}
