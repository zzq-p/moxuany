package com.ruoyi.food;
import com.ruoyi.common.utils.SecurityUtils;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;
@Service
public class FoodDelivery {
 private final JdbcTemplate db;private final FoodOrders orders;
 public FoodDelivery(JdbcTemplate db,FoodOrders orders){this.db=db;this.orders=orders;}
 long rider(){long id=SecurityUtils.getUserId();require(db.queryForObject("SELECT COUNT(*) FROM food_rider_user WHERE user_id=? AND active=1",Integer.class,id)==1,"请使用已启用的骑手账号");return id;}
 long lockedRider(){long id=SecurityUtils.getUserId();var rows=db.queryForList("SELECT active FROM food_rider_user WHERE user_id=? FOR UPDATE",id);require(!rows.isEmpty()&&number(rows.get(0),"active")==1,"请使用已启用的骑手账号");return id;}
 @Transactional public void active(long id,Integer active){require(active!=null&&(active==0||active==1),"状态不合法");require(!db.queryForList("SELECT user_id FROM food_rider_user WHERE user_id=? FOR UPDATE",id).isEmpty(),"骑手不存在");if(active==0)require(db.queryForObject("SELECT COUNT(*) FROM food_order WHERE rider_id=? AND status='DELIVERING'",Integer.class,id)==0,"骑手还有配送中的订单，请先完成配送");db.update("UPDATE food_rider_user SET active=? WHERE user_id=?",active,id);}
 public Map<String,Object> list(String mode,int page){long user=rider();require(page>=1&&page<=10000,"页码不合法");require(Set.of("AVAILABLE","MINE","DONE").contains(mode),"配送筛选不合法");boolean available=mode.equals("AVAILABLE");String where=available?"o.status='WAITING_DELIVERY' AND o.rider_id IS NULL AND o.refund_status<>'REQUESTED'":"o.rider_id="+user+(mode.equals("MINE")?" AND o.status='DELIVERING'":" AND o.status IN ('COMPLETED','REFUNDED')");
  long total=db.queryForObject("SELECT COUNT(*) FROM food_order o WHERE "+where,Long.class);String fields="o.id,o.type,o.status,o.created_at,o.scheduled_at,o.refund_status,s.name store_name,s.zone,s.phone store_phone"+(available?"":",o.address");
  return Map.of("rows",db.queryForList("SELECT "+fields+" FROM food_order o JOIN food_store s ON s.id=o.store_id WHERE "+where+" ORDER BY o.created_at,o.id LIMIT 20 OFFSET ?",(page-1)*20),"total",total);
 }
 @Transactional public void claim(String id){long user=lockedRider();var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"配送单不存在");var o=rows.get(0);if(o.get("rider_id")!=null&&number(o,"rider_id")==user&&"DELIVERING".equals(o.get("status")))return;require("WAITING_DELIVERY".equals(o.get("status"))&&o.get("rider_id")==null&&!"REQUESTED".equals(o.get("refund_status")),"订单已被接走或暂不可配送");db.update("UPDATE food_order SET rider_id=?,rider_claimed_at=NOW(),status='DELIVERING' WHERE id=?",user,id);}
 @Transactional public void complete(String id){long user=lockedRider();var rows=db.queryForList("SELECT rider_id FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty()&&rows.get(0).get("rider_id")!=null&&number(rows.get(0),"rider_id")==user,"只能完成自己接的配送单");orders.transition(id,null,"COMPLETED");}
}
