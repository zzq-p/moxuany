package com.ruoyi.food;

import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.annotation.Log;
import com.ruoyi.common.enums.BusinessType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import static com.ruoyi.food.FoodSupport.*;

@RestController
@RequestMapping("/food/admin")
@PreAuthorize("@ss.hasPermi('food:manage')")
public class FoodAdminController {
 private final JdbcTemplate db;private final FoodOrders orders;private final FoodSupport support;private final FoodScope scope;private final FoodMerchantAccounts accounts;
 public FoodAdminController(JdbcTemplate db,FoodOrders orders,FoodSupport support,FoodScope scope,FoodMerchantAccounts accounts){this.db=db;this.orders=orders;this.support=support;this.scope=scope;this.accounts=accounts;}
 @GetMapping("/scope") public AjaxResult scope(){return AjaxResult.success(Map.of("platform",scope.platform()));}
 @GetMapping("/overview") public AjaxResult overview(){Map<String,Object> data=new HashMap<>();String condition=scope.condition("store_id");data.put("today",db.queryForMap("SELECT COUNT(*) orders,COALESCE(SUM(IF(status NOT IN ('UNPAID','CANCELLED'),total,0)),0) revenue,COALESCE(SUM(status='PENDING'),0) pending FROM food_order WHERE created_at>=CURRENT_DATE AND "+condition));data.put("members",scope.platform()?db.queryForObject("SELECT COUNT(*) FROM food_member",Integer.class):db.queryForObject("SELECT COUNT(DISTINCT member_id) FROM food_order WHERE "+condition,Integer.class));data.put("stores",db.queryForObject("SELECT COUNT(*) FROM food_store WHERE active=1 AND "+scope.condition("id"),Integer.class));data.put("trend",db.queryForList("SELECT DATE(created_at) day,COUNT(*) orders,COALESCE(SUM(IF(status NOT IN ('UNPAID','CANCELLED'),total,0)),0) revenue FROM food_order WHERE created_at>=DATE_SUB(CURRENT_DATE,INTERVAL 6 DAY) AND "+condition+" GROUP BY DATE(created_at) ORDER BY day"));data.put("popular",db.queryForList("SELECT name,sales,stock FROM food_product WHERE "+condition+" ORDER BY sales DESC LIMIT 5"));return AjaxResult.success(data);}
 @GetMapping("/stores") public AjaxResult stores(){return AjaxResult.success(db.queryForList("SELECT s.*,(SELECT GROUP_CONCAT(u.user_name) FROM food_store_user su JOIN sys_user u ON u.user_id=su.user_id WHERE su.store_id=s.id) accounts FROM food_store s WHERE "+scope.condition("s.id")+" ORDER BY s.id"));}
 @GetMapping("/products") public AjaxResult products(@RequestParam(required=false) Long storeId){if(storeId!=null)scope.store(storeId);return AjaxResult.success(db.queryForList("SELECT p.*,s.name store_name FROM food_product p JOIN food_store s ON s.id=p.store_id WHERE "+scope.condition("p.store_id")+(storeId==null?"":" AND p.store_id="+storeId)+" ORDER BY p.id DESC LIMIT 1000"));}
 @Log(title="开通商家账号",businessType=BusinessType.INSERT)
 @PostMapping("/stores/{id}/account") public AjaxResult account(@PathVariable long id,@RequestBody Map<String,String> body){accounts.create(id,body.get("username"),body.get("password"));return AjaxResult.success();}
 @Log(title="批量导入商家",businessType=BusinessType.IMPORT)
 @Transactional
 @PostMapping("/stores/import") public AjaxResult importStores(@RequestBody List<Map<String,Object>> rows){scope.platformOnly();require(!rows.isEmpty()&&rows.size()<=500,"每批须为1至500行");for(var row:rows){require(row.get("id")==null,"导入只允许新增，请勿包含id");saveStore(row);}return AjaxResult.success(Map.of("count",rows.size()));}
 @Log(title="批量导入菜品",businessType=BusinessType.IMPORT)
 @Transactional
 @PostMapping("/products/import") public AjaxResult importProducts(@RequestBody List<Map<String,Object>> rows){require(!rows.isEmpty()&&rows.size()<=500,"每批须为1至500行");for(var row:rows){require(row.get("id")==null,"导入只允许新增，请勿包含id");saveProduct(row);}return AjaxResult.success(Map.of("count",rows.size()));}
 private int integer(Map<String,Object> m,String k,int min,int max){int n;try{n=Integer.parseInt(text(m,k));}catch(Exception e){throw new com.ruoyi.common.exception.ServiceException(k+"必须为整数");}require(n>=min&&n<=max,k+"超出允许范围");return n;}
 private String str(Map<String,Object> m,String k,int max,boolean required){String s=text(m,k).trim();require(s.length()<=max&&(!required||!s.isEmpty()),k+"长度不合法");return s;}
 @Log(title="点餐商家",businessType=BusinessType.UPDATE)
 @PostMapping("/stores") public AjaxResult saveStore(@RequestBody Map<String,Object> m){
   if(m.get("id")==null)scope.platformOnly();else scope.store(Long.parseLong(text(m,"id")));
   Double latitude=FoodLocationController.coordinate(m.get("latitude"),90),longitude=FoodLocationController.coordinate(m.get("longitude"),180);
   require((latitude==null)==(longitude==null),"经纬度必须一起填写或一起留空");
   if(m.get("id")!=null){var old=db.queryForMap("SELECT open_time,close_time,delivery_radius FROM food_store WHERE id=?",m.get("id"));for(String key:old.keySet())if(!m.containsKey(key))m.put(key,old.get(key));}
   String open=str(m,"open_time",5,false),close=str(m,"close_time",5,false);FoodBusinessRules.validateHours(open,close);
   int radius=m.get("delivery_radius")==null?0:integer(m,"delivery_radius",0,50000);require(radius==0||(latitude!=null&&longitude!=null),"设置配送半径前请填写店铺GPS坐标");
   List<Object> a=new ArrayList<>(List.of(str(m,"name",80,true),str(m,"category",40,true),str(m,"zone",40,true),str(m,"description",500,false),str(m,"image",500,true),integer(m,"minutes",1,180),0,integer(m,"delivery_fee",0,10000),integer(m,"minimum",0,100000),str(m,"notice",500,false),str(m,"phone",30,false),integer(m,"active",0,1)));
   a.add(latitude);a.add(longitude);a.add(open);a.add(close);a.add(radius);
   if(m.get("id")==null)db.update("INSERT INTO food_store(name,category,zone,description,image,minutes,distance,delivery_fee,minimum,notice,phone,active,latitude,longitude,open_time,close_time,delivery_radius) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",a.toArray());
   else{a.add(m.get("id"));require(db.update("UPDATE food_store SET name=?,category=?,zone=?,description=?,image=?,minutes=?,distance=?,delivery_fee=?,minimum=?,notice=?,phone=?,active=?,latitude=?,longitude=?,open_time=?,close_time=?,delivery_radius=? WHERE id=?",a.toArray())==1,"商家不存在");}
   support.invalidate(m.get("id")==null?0:Long.parseLong(text(m,"id")));return AjaxResult.success();
 }
 @Log(title="点餐商品",businessType=BusinessType.UPDATE)
 @PostMapping("/products") public AjaxResult saveProduct(@RequestBody Map<String,Object> m){
   int store=integer(m,"store_id",1,Integer.MAX_VALUE);scope.store(store);require(db.queryForObject("SELECT COUNT(*) FROM food_store WHERE id=?",Integer.class,store)==1,"商家不存在");
   List<Object> a=new ArrayList<>(List.of(store,str(m,"name",100,true),str(m,"category",50,true),str(m,"description",500,false),str(m,"image",500,true),integer(m,"price",1,1000000),integer(m,"stock",0,1000000),integer(m,"active",0,1)));
   if(m.get("id")==null)db.update("INSERT INTO food_product(store_id,name,category,description,image,price,stock,active) VALUES(?,?,?,?,?,?,?,?)",a.toArray());
   else{require(db.queryForObject("SELECT COUNT(*) FROM food_product WHERE id=? AND store_id=?",Integer.class,m.get("id"),store)==1,"商品不存在，商品创建后不能更换所属商家");a.add(m.get("id"));a.add(integer(m,"version",0,Integer.MAX_VALUE));require(db.update("UPDATE food_product SET store_id=?,name=?,category=?,description=?,image=?,price=?,stock=?,active=?,version=version+1 WHERE id=? AND version=?",a.toArray())==1,"库存或商品已更新，请刷新列表后重新编辑");}
   support.invalidate(store);return AjaxResult.success();
 }
 @GetMapping("/orders") public AjaxResult orders(@RequestParam(defaultValue="1") int page,@RequestParam(defaultValue="") String status){int offset=(Math.min(Math.max(page,1),10000)-1)*20;String filter=" WHERE "+scope.condition("o.store_id")+(status.isBlank()?"":" AND o.status=?");List<Object> a=new ArrayList<>();if(!status.isBlank())a.add(status);long count=db.queryForObject("SELECT COUNT(*) FROM food_order o"+filter,Long.class,a.toArray());a.add(offset);List<Map<String,Object>> rows=db.queryForList("SELECT o.*,s.name store_name FROM food_order o JOIN food_store s ON s.id=o.store_id"+filter+" ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET ?",a.toArray());return AjaxResult.success(Map.of("rows",rows,"total",count));}
 @GetMapping("/order-alerts") public AjaxResult alerts(){
   String where=" WHERE o.status='PENDING' AND "+scope.condition("o.store_id");
   var summary=db.queryForMap("SELECT COUNT(*) pending,COALESCE(SUM(o.paid_at<=DATE_SUB(NOW(),INTERVAL 5 MINUTE)),0) overdue FROM food_order o"+where);
   summary.put("rows",db.queryForList("SELECT o.id,o.store_id,s.name store_name,o.paid_at,TIMESTAMPDIFF(SECOND,o.paid_at,NOW()) waiting_seconds FROM food_order o JOIN food_store s ON s.id=o.store_id"+where+" ORDER BY o.paid_at DESC,o.id DESC LIMIT 50"));
   return AjaxResult.success(summary);
 }
 @GetMapping("/orders/{id}") public AjaxResult order(@PathVariable String id){scope.order(id);List<Long> ids=db.queryForList("SELECT member_id FROM food_order WHERE id=?",Long.class,id);require(!ids.isEmpty(),"订单不存在");return AjaxResult.success(orders.detail(ids.get(0),id));}
 @Log(title="点餐订单流转",businessType=BusinessType.UPDATE)
 @PostMapping("/orders/{id}/status") public AjaxResult status(@PathVariable String id,@RequestBody Map<String,String> body){scope.order(id);String target=body.get("status");require(target!=null&&Set.of("PREPARING","DELIVERING","READY","COMPLETED","CANCELLED").contains(target),"无效的目标状态");orders.transition(id,null,target);return AjaxResult.success();}
 @GetMapping("/members") public AjaxResult members(){scope.platformOnly();return AjaxResult.success(db.queryForList("SELECT id,nickname,points,created_at FROM food_member ORDER BY id DESC LIMIT 500"));}
 @GetMapping("/feedback") public AjaxResult feedback(){scope.platformOnly();return AjaxResult.success(db.queryForList("SELECT * FROM food_feedback ORDER BY id DESC LIMIT 500"));}
 @Log(title="回复点餐反馈",businessType=BusinessType.UPDATE)
 @PostMapping("/feedback/{id}") public AjaxResult reply(@PathVariable long id,@RequestBody Map<String,Object> body){scope.platformOnly();require(db.update("UPDATE food_feedback SET reply=? WHERE id=?",str(body,"reply",1000,true),id)==1,"反馈不存在");return AjaxResult.success();}
}
