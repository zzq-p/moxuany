package com.ruoyi.food;
import com.ruoyi.common.utils.SecurityUtils;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import static com.ruoyi.food.FoodSupport.*;

/** All merchant scope is derived from the authenticated RuoYi user, never from request claims. */
@Component
public class FoodScope {
 private final JdbcTemplate db;
 public FoodScope(JdbcTemplate db){this.db=db;}
 public boolean platform(){return SecurityUtils.isAdmin();}
 public void platformOnly(){require(platform(),"仅总后台可操作");}
 public String condition(String storeColumn){return platform()?"1=1":storeColumn+" IN (SELECT store_id FROM food_store_user WHERE user_id="+SecurityUtils.getUserId()+")";}
 public void store(long id){require(db.queryForObject("SELECT COUNT(*) FROM food_store WHERE id=? AND "+condition("id"),Integer.class,id)==1,"商家不存在或无权访问");}
 public void order(String id){require(db.queryForObject("SELECT COUNT(*) FROM food_order WHERE id=? AND "+condition("store_id"),Integer.class,id)==1,"订单不存在或无权访问");}
}
