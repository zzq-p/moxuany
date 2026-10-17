package com.ruoyi.food;

import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.annotation.Log;
import com.ruoyi.common.enums.BusinessType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.security.SecureRandom;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import com.ruoyi.common.utils.SecurityUtils;
import static com.ruoyi.food.FoodSupport.*;

@RestController
@RequestMapping("/food/admin")
@PreAuthorize("@ss.hasPermi('food:manage')")
public class FoodAdminController {
 private final JdbcTemplate db;private final FoodOrders orders;private final FoodSupport support;private final FoodScope scope;private final FoodMerchantAccounts accounts;private final FoodOptions options;private final FoodRefunds refunds;private final FoodReviews reviews;private final FoodReservationStock reservations;@org.springframework.beans.factory.annotation.Value("${food.demo-enabled:false}") private boolean demo;@org.springframework.beans.factory.annotation.Value("${food.mock-payment-enabled:true}") private boolean mockPayment;
 public FoodAdminController(JdbcTemplate db,FoodOrders orders,FoodSupport support,FoodScope scope,FoodMerchantAccounts accounts,FoodOptions options,FoodRefunds refunds,FoodReviews reviews,FoodReservationStock reservations){this.reviews=reviews;this.reservations=reservations;this.options=options;this.refunds=refunds;this.db=db;this.orders=orders;this.support=support;this.scope=scope;this.accounts=accounts;}
 @GetMapping("/scope") public AjaxResult scope(){return AjaxResult.success(Map.of("platform",scope.platform(),"stores",scope.permissions()));}
 @GetMapping("/overview") public AjaxResult overview(){scope.managerOnly();Map<String,Object> data=new HashMap<>();String condition=scope.condition("store_id");data.put("today",db.queryForMap("SELECT COUNT(*) orders,COALESCE(SUM(IF(status NOT IN ('UNPAID','CANCELLED','REFUNDED'),total-refunded_amount,0)),0) revenue,COALESCE(SUM(status='PENDING'),0) pending FROM food_order WHERE created_at>=CURRENT_DATE AND "+condition));data.put("members",scope.platform()?db.queryForObject("SELECT COUNT(*) FROM food_member",Integer.class):db.queryForObject("SELECT COUNT(DISTINCT member_id) FROM food_order WHERE "+condition,Integer.class));data.put("stores",db.queryForObject("SELECT COUNT(*) FROM food_store WHERE active=1 AND "+scope.condition("id"),Integer.class));data.put("trend",db.queryForList("SELECT DATE(created_at) day,COUNT(*) orders,COALESCE(SUM(IF(status NOT IN ('UNPAID','CANCELLED','REFUNDED'),total-refunded_amount,0)),0) revenue FROM food_order WHERE created_at>=DATE_SUB(CURRENT_DATE,INTERVAL 6 DAY) AND "+condition+" GROUP BY DATE(created_at) ORDER BY day"));data.put("popular",db.queryForList("SELECT name,sales,stock FROM food_product WHERE "+condition+" ORDER BY sales DESC LIMIT 5"));return AjaxResult.success(data);}
 @GetMapping("/stores") public AjaxResult stores(){return AjaxResult.success(db.queryForList("SELECT s.*,(SELECT GROUP_CONCAT(u.user_name) FROM food_store_user su JOIN sys_user u ON u.user_id=su.user_id WHERE su.store_id=s.id) accounts FROM food_store s WHERE "+scope.condition("s.id")+" ORDER BY s.id"));}
 @GetMapping("/products") public AjaxResult products(@RequestParam(required=false) Long storeId){if(storeId!=null)scope.store(storeId);return AjaxResult.success(db.queryForList("SELECT p.*,s.name store_name FROM food_product p JOIN food_store s ON s.id=p.store_id WHERE "+scope.condition("p.store_id")+(storeId==null?"":" AND p.store_id="+storeId)+" ORDER BY p.id DESC LIMIT 1000"));}
 @Log(title="开通商家账号",businessType=BusinessType.INSERT)
 @PostMapping("/stores/{id}/account") public AjaxResult account(@PathVariable long id,@RequestBody Map<String,String> body){accounts.create(id,body.get("username"),body.get("password"));return AjaxResult.success();}
 @Log(title="店铺营业状态",businessType=BusinessType.UPDATE)
 @Transactional @PostMapping("/stores/{id}/active") public AjaxResult active(@PathVariable long id,@RequestBody Map<String,Object> body){
   scope.permit(id,"CATALOG");int active=integer(body,"active",0,1);
   require(db.update("UPDATE food_store SET active=? WHERE id=?",active,id)==1,"商家不存在");
   scope.audit(id,"STORE_EDIT",Long.toString(id),active==1?"开启营业":"店铺休息");support.invalidate(id);return AjaxResult.success();
 }
 @Log(title="批量导入商家",businessType=BusinessType.IMPORT)
 @Transactional
 @PostMapping("/stores/import") public AjaxResult importStores(@RequestBody List<Map<String,Object>> rows){scope.platformOnly();require(!rows.isEmpty()&&rows.size()<=500,"每批须为1至500行");for(var row:rows){require(row.get("id")==null,"导入只允许新增，请勿包含id");saveStore(row);}return AjaxResult.success(Map.of("count",rows.size()));}
 @Log(title="批量导入菜品",businessType=BusinessType.IMPORT)
 @Transactional
 @PostMapping("/products/import") public AjaxResult importProducts(@RequestBody List<Map<String,Object>> rows){require(!rows.isEmpty()&&rows.size()<=500,"每批须为1至500行");for(var row:rows){require(row.get("id")==null,"导入只允许新增，请勿包含id");saveProduct(row);}return AjaxResult.success(Map.of("count",rows.size()));}
 private int integer(Map<String,Object> m,String k,int min,int max){int n;try{n=Integer.parseInt(text(m,k));}catch(Exception e){throw new com.ruoyi.common.exception.ServiceException(k+"必须为整数");}require(n>=min&&n<=max,k+"超出允许范围");return n;}
 private String str(Map<String,Object> m,String k,int max,boolean required){String s=text(m,k).trim();require(s.length()<=max&&(!required||!s.isEmpty()),k+"长度不合法");return s;}
 @Log(title="点餐商家",businessType=BusinessType.UPDATE)
 @Transactional @PostMapping("/stores") public AjaxResult saveStore(@RequestBody Map<String,Object> m){
   if(m.get("id")==null)scope.platformOnly();else scope.permit(Long.parseLong(text(m,"id")),"CATALOG");
   Double latitude=FoodLocationController.coordinate(m.get("latitude"),90),longitude=FoodLocationController.coordinate(m.get("longitude"),180);
   require((latitude==null)==(longitude==null),"经纬度必须一起填写或一起留空");
   if(m.get("id")!=null){var old=db.queryForMap("SELECT open_time,close_time,delivery_radius,business_periods,reservation_enabled,reservation_days,lead_minutes,slot_limit,kitchen_capacity,cooking_minutes FROM food_store WHERE id=?",m.get("id"));for(String key:old.keySet())if(!m.containsKey(key))m.put(key,old.get(key));}
   String open=str(m,"open_time",5,false),close=str(m,"close_time",5,false);FoodBusinessRules.validateHours(open,close);
   int radius=m.get("delivery_radius")==null?0:integer(m,"delivery_radius",0,50000);require(radius==0||(latitude!=null&&longitude!=null),"设置配送半径前请填写店铺GPS坐标");
   List<Object> a=new ArrayList<>(List.of(str(m,"name",80,true),str(m,"category",40,true),str(m,"zone",40,true),str(m,"description",500,false),str(m,"image",500,true),integer(m,"minutes",1,180),0,integer(m,"delivery_fee",0,10000),integer(m,"minimum",0,100000),str(m,"notice",500,false),str(m,"phone",30,false),integer(m,"active",0,1)));
   a.add(latitude);a.add(longitude);a.add(open);a.add(close);a.add(radius);
   String periods=str(m,"business_periods",200,false).replace(" ","");FoodBusinessRules.validatePeriods(periods);a.add(periods);a.add(m.get("reservation_enabled")==null?0:integer(m,"reservation_enabled",0,1));a.add(m.get("reservation_days")==null?3:integer(m,"reservation_days",1,7));a.add(m.get("lead_minutes")==null?30:integer(m,"lead_minutes",15,240));a.add(m.get("slot_limit")==null?20:integer(m,"slot_limit",1,10000));a.add(m.get("kitchen_capacity")==null?3:integer(m,"kitchen_capacity",1,30));a.add(m.get("cooking_minutes")==null?15:integer(m,"cooking_minutes",1,180));
   if(m.get("id")==null)db.update("INSERT INTO food_store(name,category,zone,description,image,minutes,distance,delivery_fee,minimum,notice,phone,active,latitude,longitude,open_time,close_time,delivery_radius,business_periods,reservation_enabled,reservation_days,lead_minutes,slot_limit,kitchen_capacity,cooking_minutes,rating) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",a.toArray());
   else{a.add(m.get("id"));require(db.update("UPDATE food_store SET name=?,category=?,zone=?,description=?,image=?,minutes=?,distance=?,delivery_fee=?,minimum=?,notice=?,phone=?,active=?,latitude=?,longitude=?,open_time=?,close_time=?,delivery_radius=?,business_periods=?,reservation_enabled=?,reservation_days=?,lead_minutes=?,slot_limit=?,kitchen_capacity=?,cooking_minutes=? WHERE id=?",a.toArray())==1,"商家不存在");}
   if(m.get("id")!=null)scope.audit(Long.parseLong(text(m,"id")),"STORE_EDIT",text(m,"id"),"修改店铺设置");support.invalidate(m.get("id")==null?0:Long.parseLong(text(m,"id")));return AjaxResult.success();
 }
 @Log(title="点餐商品",businessType=BusinessType.UPDATE)
 @Transactional @PostMapping("/products") public AjaxResult saveProduct(@RequestBody Map<String,Object> m){
   int store=integer(m,"store_id",1,Integer.MAX_VALUE);scope.permit(store,"CATALOG");require(db.queryForObject("SELECT COUNT(*) FROM food_store WHERE id=?",Integer.class,store)==1,"商家不存在");
   List<Object> a=new ArrayList<>(List.of(store,str(m,"name",100,true),str(m,"category",50,true),str(m,"description",500,false),str(m,"image",500,true),integer(m,"price",1,1000000),integer(m,"stock",0,1000000),integer(m,"active",0,1)));
   if(m.get("id")==null)db.update("INSERT INTO food_product(store_id,name,category,description,image,price,stock,active) VALUES(?,?,?,?,?,?,?,?)",a.toArray());
   else{require(db.queryForObject("SELECT COUNT(*) FROM food_product WHERE id=? AND store_id=?",Integer.class,m.get("id"),store)==1,"商品不存在，商品创建后不能更换所属商家");a.add(m.get("id"));a.add(integer(m,"version",0,Integer.MAX_VALUE));require(db.update("UPDATE food_product SET store_id=?,name=?,category=?,description=?,image=?,price=?,stock=?,active=?,version=version+1 WHERE id=? AND version=?",a.toArray())==1,"库存或商品已更新，请刷新列表后重新编辑");}
   scope.audit(store,"PRODUCT_EDIT",text(m,"id"),"价格 "+text(m,"price")+" 分 / 库存 "+text(m,"stock"));support.invalidate(store);return AjaxResult.success();
 }
 @GetMapping("/products/{id}/options") public AjaxResult options(@PathVariable long id){scope.store(db.queryForObject("SELECT store_id FROM food_product WHERE id=?",Long.class,id));return AjaxResult.success(options.list(id));}
 @Log(title="菜品规格加料",businessType=BusinessType.UPDATE) @PostMapping("/products/{id}/options") public AjaxResult options(@PathVariable long id,@RequestBody List<Map<String,Object>> rows){scope.store(db.queryForObject("SELECT store_id FROM food_product WHERE id=?",Long.class,id));scope.permit(db.queryForObject("SELECT store_id FROM food_product WHERE id=?",Long.class,id),"CATALOG");options.save(id,rows);scope.audit(db.queryForObject("SELECT store_id FROM food_product WHERE id=?",Long.class,id),"OPTIONS_EDIT",Long.toString(id),"修改规格加料");return AjaxResult.success();}
 @Log(title="商家缺货退单",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/reject") public AjaxResult reject(@PathVariable String id,@RequestBody Map<String,String> body){require(mockPayment,"当前仅支持模拟退款");long store=scope.permitOrder(id,"REFUND");refunds.merchantCancel(id,body.get("reason"));scope.audit(store,"MERCHANT_REFUND",id,body.get("reason"));return AjaxResult.success();}
 @Log(title="模拟退款审核",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/refund") public AjaxResult refund(@PathVariable String id,@RequestBody Map<String,String> body){require(mockPayment,"当前仅支持模拟退款");long store=scope.permitOrder(id,"REFUND");refunds.resolve(id,body.get("refundId"),body.get("decision"),body.get("reply"));scope.audit(store,"REFUND_REVIEW",id,body.get("decision")+"："+body.get("reply"));return AjaxResult.success();}
 @GetMapping("/orders") public AjaxResult orders(@RequestParam(defaultValue="1") int page,@RequestParam(defaultValue="") String status){int offset=(Math.min(Math.max(page,1),10000)-1)*20;String filter=" WHERE "+scope.condition("o.store_id")+(status.isBlank()?"":status.equals("AFTERSALE")?" AND o.refund_status='REQUESTED'":" AND o.status=?");List<Object> a=new ArrayList<>();if(!status.isBlank()&&!status.equals("AFTERSALE"))a.add(status);long count=db.queryForObject("SELECT COUNT(*) FROM food_order o"+filter,Long.class,a.toArray());a.add(offset);List<Map<String,Object>> rows=db.queryForList("SELECT o.*,s.name store_name FROM food_order o JOIN food_store s ON s.id=o.store_id"+filter+" ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET ?",a.toArray());return AjaxResult.success(Map.of("rows",rows.stream().map(FoodOrders::merchantView).toList(),"total",count));}
 @GetMapping("/order-alerts") public AjaxResult alerts(){
   String where=" WHERE o.status='PENDING' AND o.refund_status<>'REQUESTED' AND (o.prepare_at IS NULL OR o.prepare_at<=NOW()) AND "+scope.condition("o.store_id");
   var summary=db.queryForMap("SELECT COUNT(*) pending,COALESCE(SUM(GREATEST(o.paid_at,COALESCE(o.prepare_at,o.paid_at))<=DATE_SUB(NOW(),INTERVAL 5 MINUTE)),0) overdue FROM food_order o"+where);
   summary.put("rows",db.queryForList("SELECT o.id,o.store_id,s.name store_name,o.paid_at,TIMESTAMPDIFF(SECOND,GREATEST(o.paid_at,COALESCE(o.prepare_at,o.paid_at)),NOW()) waiting_seconds FROM food_order o JOIN food_store s ON s.id=o.store_id"+where+" ORDER BY o.paid_at DESC,o.id DESC LIMIT 50"));
   summary.put("deliveryOverdue",db.queryForObject("SELECT COUNT(*) FROM food_order o WHERE o.status='WAITING_DELIVERY' AND o.refund_status<>'REQUESTED' AND o.delivery_waiting_at<=DATE_SUB(NOW(),INTERVAL 10 MINUTE) AND "+scope.condition("o.store_id"),Long.class));
   summary.put("deliveryIssues",db.queryForObject("SELECT COUNT(*) FROM food_order o WHERE o.status='DELIVERING' AND o.delivery_issue<>'' AND "+scope.condition("o.store_id"),Long.class));
   return AjaxResult.success(summary);
 }
 @GetMapping("/orders/{id}") public AjaxResult order(@PathVariable String id){scope.order(id);List<Long> ids=db.queryForList("SELECT member_id FROM food_order WHERE id=?",Long.class,id);require(!ids.isEmpty(),"订单不存在");return AjaxResult.success(FoodOrders.merchantView(orders.detail(ids.get(0),id)));}
 @Log(title="点餐订单流转",businessType=BusinessType.UPDATE)
  @PostMapping("/orders/{id}/status") public AjaxResult status(@PathVariable String id,@RequestBody Map<String,String> body){
    scope.order(id);String target=body.get("status");
    require(target!=null&&Set.of("PREPARING","WAITING_DELIVERY","DELIVERING","READY","COMPLETED","CANCELLED").contains(target),"无效的目标状态");
    // Direct merchant delivery also confirms that preparation has finished.
    String capability=Set.of("READY","WAITING_DELIVERY","DELIVERING").contains(target)?"COOK":"ORDER";
    long store=scope.permitOrder(id,capability);
    orders.transition(id,null,target);scope.audit(store,"ORDER_STATUS",id,target);return AjaxResult.success();
  }
 @GetMapping("/products/{id}/reservation-stock") public AjaxResult stock(@PathVariable long id,@RequestParam String date){scope.store(db.queryForObject("SELECT store_id FROM food_product WHERE id=?",Long.class,id));return AjaxResult.success(reservations.list(id,date));}
 @Log(title="按日预约库存",businessType=BusinessType.UPDATE) @PostMapping("/products/{id}/reservation-stock") public AjaxResult stock(@PathVariable long id,@RequestParam String date,@RequestBody List<Map<String,Object>> rows){scope.store(db.queryForObject("SELECT store_id FROM food_product WHERE id=?",Long.class,id));long store=db.queryForObject("SELECT store_id FROM food_product WHERE id=?",Long.class,id);scope.permit(store,"CATALOG");reservations.save(id,date,rows);scope.audit(store,"DAILY_STOCK",Long.toString(id),date);return AjaxResult.success();}
 @Log(title="商家回复评价",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/review-reply") public AjaxResult reviewReply(@PathVariable String id,@RequestBody Map<String,String> body){scope.permitOrder(id,"REPLY");reviews.reply(id,body.get("reply"));return AjaxResult.success();}
 @GetMapping("/reviews") public AjaxResult reviews(@RequestParam(defaultValue="1") int page){require(page>=1&&page<=10000,"页码不合法");String where=" WHERE "+scope.condition("r.store_id");return AjaxResult.success(Map.of("rows",db.queryForList("SELECT r.*,s.name store_name,m.nickname FROM food_review r JOIN food_store s ON s.id=r.store_id JOIN food_member m ON m.id=r.member_id"+where+" ORDER BY r.id DESC LIMIT 20 OFFSET ?",(page-1)*20),"total",db.queryForObject("SELECT COUNT(*) FROM food_review r"+where,Long.class)));}
 @Log(title="取餐验码核销",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/verify-pickup") public AjaxResult pickup(@PathVariable String id,@RequestBody Map<String,String> body){long store=scope.permitOrder(id,"PICKUP");support.limit("pickup:"+com.ruoyi.common.utils.SecurityUtils.getUserId()+":"+id,10,60);orders.verifyPickup(id,body.get("code"));scope.audit(store,"PICKUP_VERIFY",id,"取餐核销");return AjaxResult.success();}
 @GetMapping("/members") public AjaxResult members(){scope.platformOnly();return AjaxResult.success(db.queryForList("SELECT id,account,nickname,points,created_at FROM food_member ORDER BY id DESC LIMIT 500"));}
 @GetMapping("/invites") public AjaxResult invites(@RequestParam(defaultValue="1") int page,@RequestParam(defaultValue="") String status){
   scope.platformOnly();require(page>=1&&page<=10000,"页码不合法");
   require(status.isEmpty()||Set.of("UNUSED","USED","EXPIRED").contains(status),"无效状态");
   String where=switch(status){case "UNUSED"->" WHERE i.used_by IS NULL AND (i.expires_at IS NULL OR i.expires_at>NOW())";
     case "USED"->" WHERE i.used_by IS NOT NULL";case "EXPIRED"->" WHERE i.used_by IS NULL AND i.expires_at IS NOT NULL AND i.expires_at<=NOW()";default->"";};
   long total=db.queryForObject("SELECT COUNT(*) FROM food_invite_code i"+where,Long.class);
   var summary=db.queryForMap("SELECT COALESCE(SUM(used_by IS NULL AND (expires_at IS NULL OR expires_at>NOW())),0) unused,"
     +"COALESCE(SUM(used_by IS NOT NULL),0) used,COALESCE(SUM(used_by IS NULL AND expires_at IS NOT NULL AND expires_at<=NOW()),0) expired FROM food_invite_code");
   var rows=db.queryForList("SELECT i.code,i.note,i.created_by,i.created_at,i.expires_at,i.used_by,i.used_at,m.account used_account,m.nickname used_nickname "
     +"FROM food_invite_code i LEFT JOIN food_member m ON m.id=i.used_by"+where+" ORDER BY i.created_at DESC,i.code DESC LIMIT 50 OFFSET ?",(page-1)*50);
   return AjaxResult.success(Map.of("rows",rows,"total",total,"summary",summary));
 }
 @Log(title="生成邀请码",businessType=BusinessType.INSERT)
 @Transactional @PostMapping("/invites") public AjaxResult createInvites(@RequestBody Map<String,Object> body){
   scope.platformOnly();
   int count=integer(body,"count",1,50),days=body.get("expiresInDays")==null?7:integer(body,"expiresInDays",0,365);
   String note=str(body,"note",100,false);
   String alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";SecureRandom random=new SecureRandom();
   java.sql.Timestamp expires=days==0?null:new java.sql.Timestamp(System.currentTimeMillis()+days*86400000L);
   List<String> codes=new ArrayList<>();
   for(int i=0;i<count;i++){
     boolean inserted=false;
     for(int attempt=0;attempt<8&&!inserted;attempt++){
       StringBuilder sb=new StringBuilder(12);for(int j=0;j<12;j++)sb.append(alphabet.charAt(random.nextInt(alphabet.length())));
       String code=sb.toString();
       try{db.update("INSERT INTO food_invite_code(code,note,created_by,expires_at) VALUES(?,?,?,?)",code,note,SecurityUtils.getUserId(),expires);codes.add(code);inserted=true;}
       catch(org.springframework.dao.DuplicateKeyException ignored){/* regenerate */}
     }
     require(inserted,"邀请码生成失败，请重试");
   }
   return AjaxResult.success(Map.of("codes",codes));
 }
 @GetMapping("/feedback") public AjaxResult feedback(){scope.platformOnly();return AjaxResult.success(db.queryForList("SELECT * FROM food_feedback ORDER BY id DESC LIMIT 500"));}
 @Log(title="回复点餐反馈",businessType=BusinessType.UPDATE)
 @PostMapping("/feedback/{id}") public AjaxResult reply(@PathVariable long id,@RequestBody Map<String,Object> body){scope.platformOnly();require(db.update("UPDATE food_feedback SET reply=? WHERE id=?",str(body,"reply",1000,true),id)==1,"反馈不存在");return AjaxResult.success();}
}
