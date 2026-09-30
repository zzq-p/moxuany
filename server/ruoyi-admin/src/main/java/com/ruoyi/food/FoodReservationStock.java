package com.ruoyi.food;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;

@Service
public class FoodReservationStock {
 private final JdbcTemplate db;
 public FoodReservationStock(JdbcTemplate db){this.db=db;}
 public LocalDate date(String value){try{return LocalDate.parse(value);}catch(Exception e){throw new com.ruoyi.common.exception.ServiceException("日期格式不正确");}}
 public List<Map<String,Object>> list(long product,String value){
  var day=date(value);var rows=new ArrayList<Map<String,Object>>();
  rows.add(db.queryForMap("SELECT id product_id,0 option_id,name FROM food_product WHERE id=?",product));
  rows.addAll(db.queryForList("SELECT product_id,id option_id,name FROM food_product_option WHERE product_id=? ORDER BY id",product));
  var stocks=db.queryForList("SELECT * FROM food_reservation_stock WHERE product_id=? AND stock_date=?",product,day);
  for(var row:rows){var s=stocks.stream().filter(v->number(v,"option_id")==number(row,"option_id")).findFirst();if(s.isPresent())row.putAll(s.get());else{row.put("capacity",0);row.put("used",0);row.put("version",-1);}}
  return rows;
 }
 @Transactional public void save(long product,String value,List<Map<String,Object>> rows){
  var day=date(value);var today=LocalDate.now(FoodReservations.ZONE);require(!day.isBefore(today)&&day.isBefore(today.plusDays(31)),"只能配置今天起31天内的预约库存");
  db.queryForMap("SELECT id FROM food_product WHERE id=? FOR UPDATE",product);
  require(rows!=null&&!rows.isEmpty()&&rows.size()<=31,"请填写预约库存");Set<Long> seen=new HashSet<>();
  for(var r:rows){long option,capacity,version;try{option=Long.parseLong(text(r,"option_id"));capacity=Long.parseLong(text(r,"capacity"));version=Long.parseLong(text(r,"version"));}catch(Exception e){throw new com.ruoyi.common.exception.ServiceException("库存参数不合法");}
   require(option>=0&&seen.add(option)&&capacity>=0&&capacity<=1000000&&version>=-1,"库存参数不合法");
   require(option==0||db.queryForObject("SELECT COUNT(*) FROM food_product_option WHERE id=? AND product_id=?",Integer.class,option,product)==1,"规格不属于当前菜品");
   var old=db.queryForList("SELECT * FROM food_reservation_stock WHERE product_id=? AND stock_date=? AND option_id=? FOR UPDATE",product,day,option);
   if(old.isEmpty()){require(version==-1,"库存已更新，请刷新");db.update("INSERT INTO food_reservation_stock(product_id,stock_date,option_id,capacity) VALUES(?,?,?,?)",product,day,option,capacity);}
   else{require(number(old.get(0),"version")==version,"库存已更新，请刷新");require(capacity>=number(old.get(0),"used"),"总配额不能少于已占用数量");db.update("UPDATE food_reservation_stock SET capacity=?,version=version+1 WHERE product_id=? AND stock_date=? AND option_id=?",capacity,product,day,option);}
  }
 }
 public void reserveSlot(Map<String,Object> store,LocalDateTime slot){
  // Acquire an exclusive key lock directly; INSERT IGNORE followed by UPDATE can deadlock on shared-lock upgrades.
  db.update("INSERT INTO food_reservation_slot(store_id,scheduled_at) VALUES(?,?) ON DUPLICATE KEY UPDATE used=used",store.get("id"),slot);
  require(db.update("UPDATE food_reservation_slot SET used=used+1 WHERE store_id=? AND scheduled_at=? AND used<?",store.get("id"),slot,store.get("slot_limit"))==1,"该预约时段已满，请选择其他时间");
 }
 public void take(long product,long option,LocalDate day,int quantity){
  require(db.update("UPDATE food_reservation_stock SET used=used+?,version=version+1 WHERE product_id=? AND stock_date=? AND option_id=? AND capacity-used>=?",quantity,product,day,option,quantity)==1,"该日期菜品、规格或加料预约库存不足，请调整时间或商品");
 }
 public void restore(long product,long option,Object day,Object quantity){
  require(db.update("UPDATE food_reservation_stock SET used=used-?,version=version+1 WHERE product_id=? AND stock_date=? AND option_id=? AND used>=?",quantity,product,day,option,quantity)==1,"预约库存记录异常");
 }
 public void decorate(List<Map<String,Object>> products,LocalDate day){
  if(products.isEmpty())return;
  var args=new ArrayList<Object>();args.add(day);products.forEach(p->args.add(p.get("id")));
  var stocks=db.queryForList("SELECT product_id,option_id,capacity-used remaining FROM food_reservation_stock WHERE stock_date=? AND product_id IN ("+String.join(",",Collections.nCopies(products.size(),"?"))+")",args.toArray());
  Map<String,Object> remaining=new HashMap<>();stocks.forEach(s->remaining.put(s.get("product_id")+":"+s.get("option_id"),s.get("remaining")));
  for(var p:products){p.put("stock",remaining.getOrDefault(p.get("id")+":0",0));for(var o:(List<Map<String,Object>>)p.getOrDefault("options",List.of()))o.put("stock",remaining.getOrDefault(p.get("id")+":"+o.get("id"),0));}
 }
 public List<Map<String,Object>> slots(Map<String,Object> store){
  var used=new HashMap<String,Long>();for(var r:db.queryForList("SELECT scheduled_at,used FROM food_reservation_slot WHERE store_id=? AND scheduled_at>=CURRENT_DATE",store.get("id")))used.put(LocalDateTime.parse(r.get("scheduled_at").toString().replace(' ','T')).toString(),number(r,"used"));
  var result=new ArrayList<Map<String,Object>>();for(var slot:FoodReservations.slots(store)){long remaining=number(store,"slot_limit")-used.getOrDefault(LocalDateTime.parse(slot.get("value")).toString(),0L);if(remaining>0)result.add(Map.of("value",slot.get("value"),"label",slot.get("label")+" · 余"+remaining+"单","remaining",remaining));}return result;
 }
}
