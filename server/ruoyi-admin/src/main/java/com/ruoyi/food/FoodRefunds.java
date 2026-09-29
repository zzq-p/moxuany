package com.ruoyi.food;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;
@Service
public class FoodRefunds {
 private final JdbcTemplate db;private final FoodOrders orders;
 public FoodRefunds(JdbcTemplate db,FoodOrders orders){this.db=db;this.orders=orders;}
 @Transactional public void merchantCancel(String id,String reason){var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);if("REFUNDED".equals(o.get("status")))return;require("PENDING".equals(o.get("status")),"缺货退单仅适用于尚未制作的已支付订单");require(!"REQUESTED".equals(o.get("refund_status")),"请先处理顾客的退款申请");request(number(o,"member_id"),id,reason);String refund=db.queryForObject("SELECT refund_id FROM food_order WHERE id=?",String.class,id);resolve(id,refund,"APPROVE","商家退单："+reason);}
 @Transactional public void request(long member,String id,String reason){
  require(reason!=null&&reason.trim().length()>=2&&reason.trim().length()<=500,"请填写2至500字退款原因");var rows=db.queryForList("SELECT *,completed_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR) within_window FROM food_order WHERE id=? AND member_id=? FOR UPDATE",id,member);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);
  if("REQUESTED".equals(o.get("refund_status")))return;
  require(Set.of("PENDING","PREPARING","WAITING_DELIVERY","READY","DELIVERING","COMPLETED").contains(text(o,"status")),"当前订单不能申请退款");
  require(!"COMPLETED".equals(o.get("status"))||number(o,"within_window")==1,"订单完成超过24小时，请联系平台客服");
  String refund="RF"+UUID.randomUUID().toString().replace("-","");db.update("INSERT INTO food_refund(id,order_id,member_id,reason,amount) VALUES(?,?,?,?,?)",refund,id,member,reason.trim(),o.get("total"));
  db.update("UPDATE food_order SET refund_status='REQUESTED',refund_id=? WHERE id=?",refund,id);
 }
 @Transactional public void resolve(String id,String refundId,String decision,String reply){
  require(Set.of("APPROVE","REJECT").contains(Objects.toString(decision,"")),"请选择同意或拒绝");reply=Objects.toString(reply,"").trim();require(reply.length()>=2&&reply.length()<=500,"请填写2至500字处理说明");
  var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);require(refundId!=null&&refundId.equals(o.get("refund_id")),"售后申请已更新，请刷新后处理");var r=db.queryForMap("SELECT * FROM food_refund WHERE id=? FOR UPDATE",refundId);
  String target=decision.equals("APPROVE")?"APPROVED":"REJECTED";if(target.equals(r.get("status")))return;require("REQUESTED".equals(r.get("status")),"这笔售后已处理");
  boolean restock=target.equals("APPROVED")&&"PENDING".equals(o.get("status"));
  if(target.equals("APPROVED")){
   if(restock)orders.restore(o);else db.update("UPDATE food_coupon SET used_order=NULL WHERE used_order=?",id);
   if("COMPLETED".equals(o.get("status"))){
    db.update("UPDATE food_member SET points=points-? WHERE id=?",number(o,"total")/100,o.get("member_id"));db.update("UPDATE food_store SET sales=GREATEST(0,sales-1) WHERE id=?",o.get("store_id"));
    for(var item:db.queryForList("SELECT * FROM food_order_item WHERE order_id=? ORDER BY product_id,id",id))db.update("UPDATE food_product SET sales=GREATEST(0,sales-?) WHERE id=?",item.get("quantity"),item.get("product_id"));
   }
   db.update("UPDATE food_order SET status='REFUNDED' WHERE id=?",id);
  }
  db.update("UPDATE food_refund SET status=?,reply=?,restocked=?,resolved_at=NOW() WHERE id=?",target,reply,restock?1:0,refundId);db.update("UPDATE food_order SET refund_status=? WHERE id=?",target,id);
 }
}
