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
  long total=db.queryForObject("SELECT COUNT(*) FROM food_order o WHERE "+where,Long.class);String fields="o.id,o.type,o.status,o.created_at,o.scheduled_at,o.refund_status,o.delivery_issue,o.delivery_version,o.delivery_waiting_at,s.name store_name,s.zone,s.phone store_phone"+(available?"":",o.address");
  return Map.of("rows",db.queryForList("SELECT "+fields+" FROM food_order o JOIN food_store s ON s.id=o.store_id WHERE "+where+" ORDER BY o.created_at,o.id LIMIT 20 OFFSET ?",(page-1)*20),"total",total);
 }
 @Transactional public void claim(String id){long user=lockedRider();var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"配送单不存在");var o=rows.get(0);if(o.get("rider_id")!=null&&number(o,"rider_id")==user&&"DELIVERING".equals(o.get("status")))return;require("WAITING_DELIVERY".equals(o.get("status"))&&o.get("rider_id")==null&&!"REQUESTED".equals(o.get("refund_status")),"订单已被接走或暂不可配送");capacity(user);db.update("UPDATE food_order SET rider_id=?,rider_claimed_at=NOW(),status='DELIVERING',delivery_version=delivery_version+1 WHERE id=?",user,id);orders.event(id,"DELIVERY_CLAIM","骑手接配送单");}
 @Transactional public void complete(String id){long user=lockedRider();var rows=db.queryForList("SELECT rider_id,status FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty()&&rows.get(0).get("rider_id")!=null&&number(rows.get(0),"rider_id")==user,"只能完成自己接的配送单");boolean done="COMPLETED".equals(rows.get(0).get("status"));orders.transition(id,null,"COMPLETED");if(!done)orders.event(id,"DELIVERY_COMPLETE","骑手确认送达");}
 private void capacity(long user){
  int max=db.queryForObject("SELECT max_active FROM food_rider_user WHERE user_id=?",Integer.class,user);
  // The first snapshot read happens after acquiring the rider mutex; claims and incoming transfers share that mutex.
  int active=db.queryForList("SELECT id FROM food_order WHERE rider_id=? AND status='DELIVERING'",String.class,user).size();
  require(active<max,"骑手已达到同时配送数量上限");
 }
 @Transactional public void limit(long user,Integer max){
  require(max!=null&&max>=1&&max<=50,"配送数量上限须为1至50");require(!db.queryForList("SELECT user_id FROM food_rider_user WHERE user_id=? FOR UPDATE",user).isEmpty(),"骑手不存在");
  require(db.queryForObject("SELECT COUNT(*) FROM food_order WHERE rider_id=? AND status='DELIVERING'",Integer.class,user)<=max,"上限不能小于正在配送的单数");db.update("UPDATE food_rider_user SET max_active=? WHERE user_id=?",max,user);
 }
 private String reason(String value){value=Objects.toString(value,"").trim();require(value.length()>=2&&value.length()<=400,"请填写2至400字说明");return value;}
 @Transactional public void issue(String id,String note){
  note=reason(note);long user=lockedRider();var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);
  require(o.get("rider_id")!=null&&number(o,"rider_id")==user&&"DELIVERING".equals(o.get("status")),"只能上报本人配送中的订单");
  if(note.equals(o.get("delivery_issue")))return;require(text(o,"delivery_issue").isEmpty(),"已上报异常，请等待平台处理");
  db.update("UPDATE food_order SET delivery_issue=?,delivery_version=delivery_version+1 WHERE id=?",note,id);orders.event(id,"DELIVERY_ISSUE",note);
 }
 @Transactional public void reassign(String id,long rider,long version,String note){
  note=reason(note);var target=db.queryForList("SELECT r.* FROM food_rider_user r JOIN sys_user u ON u.user_id=r.user_id WHERE r.user_id=? AND r.active=1 AND u.status='0' AND u.del_flag='0' FOR UPDATE",rider);require(!target.isEmpty(),"请选择可用骑手");
  var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);
  require(number(o,"delivery_version")==version,"配送信息已变化，请刷新后重试");require(Set.of("WAITING_DELIVERY","DELIVERING").contains(text(o,"status"))&&!"REQUESTED".equals(o.get("refund_status")),"当前订单不可派单");require(o.get("rider_id")==null||number(o,"rider_id")!=rider,"请选择其他骑手");capacity(rider);
  db.update("UPDATE food_order SET rider_id=?,rider_claimed_at=NOW(),status='DELIVERING',delivery_issue='',delivery_version=delivery_version+1 WHERE id=?",rider,id);
  orders.event(id,"DELIVERY_REASSIGN","骑手 "+Objects.toString(o.get("rider_id"),"未分配")+" → "+rider+"："+note);
 }
 @Transactional public void resolve(String id,long version,String note){
  note=reason(note);var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);
  require("DELIVERING".equals(o.get("status"))&&!text(o,"delivery_issue").isEmpty(),"订单没有待处理配送异常");require(number(o,"delivery_version")==version,"配送信息已变化，请刷新后重试");
  db.update("UPDATE food_order SET delivery_issue='',delivery_version=delivery_version+1 WHERE id=?",id);orders.event(id,"DELIVERY_RESOLVED",note);
 }
}
