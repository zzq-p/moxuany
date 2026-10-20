package com.ruoyi.food;

import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;

@Service
public class FoodRefunds {
 private final JdbcTemplate db;private final FoodOrders orders;private final FoodMessages messages;
 public FoodRefunds(JdbcTemplate db,FoodOrders orders,FoodMessages messages){this.db=db;this.orders=orders;this.messages=messages;}
 public record Selection(long itemId,int quantity) {}
 public record Request(String reason,String kind,List<Selection> items,List<String> evidenceIds) {}
 private Map<String,Object> owned(long member,String id,boolean lock){var rows=db.queryForList("SELECT *,completed_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR) within_window FROM food_order WHERE id=? AND member_id=?"+(lock?" FOR UPDATE":""),id,member);require(!rows.isEmpty(),"订单不存在");return rows.get(0);}
 private void eligible(Map<String,Object> o){
  require(Set.of("PENDING","PREPARING","WAITING_DELIVERY","READY","DELIVERING","COMPLETED").contains(text(o,"status")),"当前订单不能申请退款");
  // within_window is NULL when completed_at is missing (legacy rows); null must not reach number().
  if("COMPLETED".equals(o.get("status"))){
   Object window=o.get("within_window");
   require(window instanceof Number && ((Number)window).longValue()==1,"订单完成超过24小时，请联系平台客服");
  }
 }
 // Cumulative integer allocation preserves cents across coupons and repeated partial refunds.
 public List<Map<String,Object>> refundable(Map<String,Object> o){
  var items=db.queryForList("SELECT * FROM food_order_item WHERE order_id=? ORDER BY id",o.get("id"));long start=0,subtotal=number(o,"subtotal"),net=subtotal-number(o,"discount");
  for(var i:items){long price=number(i,"price"),q=number(i,"quantity"),used=number(i,"refunded_quantity");i.put("allocation_start",start);i.put("refundable_amount",subtotal==0?0:((start+price*q)*net/subtotal-(start+price*used)*net/subtotal));i.put("remaining_quantity",q-used);start+=price*q;}return items;
 }
 private Map<String,Object> quote(Map<String,Object> o,Request request){
  eligible(o);String kind=Objects.toString(request.kind(),"FULL");require(Set.of("FULL","ITEMS").contains(kind),"请选择整单退款或按菜品退款");var items=refundable(o);Map<Long,Integer> selected=new TreeMap<>();
  if(kind.equals("FULL")){for(var i:items)if(number(i,"remaining_quantity")>0)selected.put(number(i,"id"),(int)number(i,"remaining_quantity"));}
  else{require(request.items()!=null&&!request.items().isEmpty()&&request.items().size()<=50,"请选择退款菜品和数量");for(var s:request.items()){require(s!=null&&s.quantity()>0&&s.quantity()<=99&&selected.putIfAbsent(s.itemId(),s.quantity())==null,"退款数量不合法或菜品重复");}}
  long subtotal=number(o,"subtotal"),net=subtotal-number(o,"discount");List<Map<String,Object>> lines=new ArrayList<>();long amount=0;
  for(var s:selected.entrySet()){var i=items.stream().filter(v->number(v,"id")==s.getKey()).findFirst().orElseThrow(()->new com.ruoyi.common.exception.ServiceException("退款菜品不属于该订单"));long q=s.getValue();require(q<=number(i,"remaining_quantity"),"退款数量超过剩余可退数量");long start=number(i,"allocation_start")+number(i,"price")*number(i,"refunded_quantity");long value=subtotal==0?0:((start+number(i,"price")*q)*net/subtotal-start*net/subtotal);amount+=value;lines.add(Map.of("itemId",s.getKey(),"name",i.get("name"),"quantity",q,"amount",value));}
  boolean full=items.stream().allMatch(i->selected.getOrDefault(number(i,"id"),0)==number(i,"remaining_quantity"));if(full){kind="FULL";amount=number(o,"total")-number(o,"refunded_amount");}
  // amount may be 0 for a fully discounted order; merchant out-of-stock cancellation still has to go through.
  require(amount>=0&&amount<=number(o,"total")-number(o,"refunded_amount"),"可退金额异常");return Map.of("kind",kind,"amount",amount,"items",lines);
 }
 public Map<String,Object> quote(long member,String id,Request request){return quote(owned(member,id,false),request);}
 @Transactional public void request(long member,String id,String reason){request(member,id,new Request(reason,"FULL",List.of(),List.of()));}
 @Transactional public void request(long member,String id,Request request){
  String reason=Objects.toString(request.reason(),"").trim();require(reason.length()>=2&&reason.length()<=500,"请填写2至500字退款原因");var o=owned(member,id,true);if("REQUESTED".equals(o.get("refund_status")))return;
  var quoted=quote(o,request);var evidence=request.evidenceIds()==null?List.<String>of():request.evidenceIds();require(evidence.size()<=3&&new HashSet<>(evidence).size()==evidence.size(),"每次售后最多3张不同凭证");for(String e:evidence)require(e!=null&&db.queryForObject("SELECT COUNT(*) FROM food_evidence WHERE id=? AND order_id=? AND member_id=?",Integer.class,e,id,member)==1,"凭证不属于当前订单");
  String refund="RF"+UUID.randomUUID().toString().replace("-","");db.update("INSERT INTO food_refund(id,order_id,member_id,reason,amount,kind) VALUES(?,?,?,?,?,?)",refund,id,member,reason,quoted.get("amount"),quoted.get("kind"));
  for(var i:(List<Map<String,Object>>)quoted.get("items"))db.update("INSERT INTO food_refund_item(refund_id,item_id,quantity,amount) VALUES(?,?,?,?)",refund,i.get("itemId"),i.get("quantity"),i.get("amount"));for(String e:evidence)db.update("INSERT INTO food_refund_evidence(refund_id,evidence_id) VALUES(?,?)",refund,e);
  db.update("UPDATE food_order SET refund_status='REQUESTED',refund_id=? WHERE id=?",refund,id);
 }
 @Transactional public void merchantCancel(String id,String reason){var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);if("REFUNDED".equals(o.get("status")))return;require("PENDING".equals(o.get("status")),"缺货退单仅适用于尚未制作的已支付订单");require(!"REQUESTED".equals(o.get("refund_status")),"请先处理顾客的退款申请");request(number(o,"member_id"),id,reason);resolve(id,db.queryForObject("SELECT refund_id FROM food_order WHERE id=?",String.class,id),"APPROVE","商家退单："+reason);}
 @Transactional public void resolve(String id,String refundId,String decision,String reply){
  require(Set.of("APPROVE","REJECT").contains(Objects.toString(decision,"")),"请选择同意或拒绝");reply=Objects.toString(reply,"").trim();require(reply.length()>=2&&reply.length()<=500,"请填写2至500字处理说明");
  var rows=db.queryForList("SELECT * FROM food_order WHERE id=? FOR UPDATE",id);require(!rows.isEmpty(),"订单不存在");var o=rows.get(0);require(refundId!=null&&refundId.equals(o.get("refund_id")),"售后申请已更新，请刷新后处理");var r=db.queryForMap("SELECT * FROM food_refund WHERE id=? FOR UPDATE",refundId);
  String target=decision.equals("APPROVE")?"APPROVED":"REJECTED";if(target.equals(r.get("status")))return;require("REQUESTED".equals(r.get("status")),"这笔售后已处理");boolean restock=target.equals("APPROVED")&&"PENDING".equals(o.get("status")),full="FULL".equals(r.get("kind"));
  if(target.equals("APPROVED")){
   long amount=number(r,"amount"),before=number(o,"refunded_amount"),after=before+amount;require(after<=number(o,"total"),"退款金额超过实付金额");
   var items=db.queryForList("SELECT i.*,r.quantity refund_quantity FROM food_refund_item r JOIN food_order_item i ON i.id=r.item_id WHERE r.refund_id=? ORDER BY i.product_id,i.id",refundId);
   // Requests pending before migration have no line breakdown and are full refunds.
   if(items.isEmpty()&&full)items=db.queryForList("SELECT i.*,i.quantity-i.refunded_quantity refund_quantity FROM food_order_item i WHERE order_id=? ORDER BY product_id,id",id);
   if(restock){if(full)orders.restore(o);else for(var i:items)orders.restoreItem(o,i,(int)number(i,"refund_quantity"));}
   else if(full)db.update("UPDATE food_coupon SET used_order=NULL WHERE used_order=?",id);
   for(var i:items){require(db.update("UPDATE food_order_item SET refunded_quantity=refunded_quantity+? WHERE id=? AND refunded_quantity+?<=quantity",i.get("refund_quantity"),i.get("id"),i.get("refund_quantity"))==1,"退款数量超过剩余份数");if("COMPLETED".equals(o.get("status")))db.update("UPDATE food_product SET sales=GREATEST(0,sales-?) WHERE id=?",i.get("refund_quantity"),i.get("product_id"));}
   if("COMPLETED".equals(o.get("status"))){long points=(number(o,"total")-before)/100-(number(o,"total")-after)/100;db.update("UPDATE food_member SET points=points-? WHERE id=?",points,o.get("member_id"));if(full)db.update("UPDATE food_store SET sales=GREATEST(0,sales-1) WHERE id=?",o.get("store_id"));}
   db.update("UPDATE food_order SET refunded_amount=?,status=IF(?=1,'REFUNDED',status) WHERE id=?",after,full?1:0,id);
  }
  db.update("UPDATE food_refund SET status=?,reply=?,restocked=?,resolved_at=NOW() WHERE id=?",target,reply,restock?1:0,refundId);db.update("UPDATE food_order SET refund_status=? WHERE id=?",target,id);
  orders.event(id,"REFUND_"+target,(full?"整单":"部分")+"退款 ¥"+String.format(Locale.ROOT,"%.2f",number(r,"amount")/100.0)+"："+reply);
  messages.enqueue(id,"REFUND",refundId,target.equals("APPROVED")?"退款已同意":"退款已拒绝",number(r,"amount"));
 }
}
