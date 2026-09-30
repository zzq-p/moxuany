package com.ruoyi.food;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;

@Service
public class FoodReviews {
 private final JdbcTemplate db; private final FoodSupport support;
 public FoodReviews(JdbcTemplate db,FoodSupport support){this.db=db;this.support=support;}
 @Transactional public void submit(long member,String id,Map<String,Object> input){
  int rating;try{rating=Integer.parseInt(text(input,"rating"));}catch(Exception e){throw new com.ruoyi.common.exception.ServiceException("评分须为1至5分");}
  String content=text(input,"content").trim();require(rating>=1&&rating<=5&&content.length()>=2&&content.length()<=500,"请填写2至500字评价和1至5分评分");
  var rows=db.queryForList("SELECT * FROM food_order WHERE id=? AND member_id=? FOR UPDATE",id,member);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);
  require("COMPLETED".equals(o.get("status")),"完成订单后才能评价");long store=number(o,"store_id");
  db.queryForMap("SELECT id FROM food_store WHERE id=? FOR UPDATE",store);
  var existing=db.queryForList("SELECT rating,content FROM food_review WHERE order_id=?",id);
  if(!existing.isEmpty()){require(number(existing.get(0),"rating")==rating&&content.equals(existing.get(0).get("content")),"该订单已评价，请刷新查看");return;}
  db.update("INSERT INTO food_review(order_id,member_id,store_id,rating,content) VALUES(?,?,?,?,?)",id,member,store,rating,content);
  db.update("UPDATE food_store SET rating=(SELECT ROUND(AVG(r.rating),1) FROM food_review r WHERE r.store_id=?) WHERE id=?",store,store);
  TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization(){@Override public void afterCommit(){try{support.invalidate(store);}catch(Exception ignored){/* Catalog cache expires shortly. */}}});
 }
 @Transactional public void reply(String orderId,String reply){
  reply=Objects.toString(reply,"").trim();require(reply.length()>=2&&reply.length()<=500,"请填写2至500字回复");
  var rows=db.queryForList("SELECT id,reply FROM food_review WHERE order_id=? FOR UPDATE",orderId);require(!rows.isEmpty(),"该订单尚未评价");
  if(reply.equals(rows.get(0).get("reply")))return;
  require(text(rows.get(0),"reply").isEmpty(),"已回复，请刷新查看");
  db.update("UPDATE food_review SET reply=?,replied_at=NOW(),replied_by=? WHERE order_id=?",reply,com.ruoyi.common.utils.SecurityUtils.getUserId(),orderId);
 }
}
