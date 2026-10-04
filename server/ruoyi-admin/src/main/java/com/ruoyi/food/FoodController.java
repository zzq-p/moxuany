package com.ruoyi.food;

import com.ruoyi.common.annotation.Anonymous;
import com.ruoyi.common.core.domain.AjaxResult;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;

@Anonymous
@RestController
@RequestMapping("/food/app")
public class FoodController {
 private final JdbcTemplate db; private final FoodSupport support; private final FoodOrders orders; private final FoodMemberService members;private final FoodRefunds refunds;private final FoodReviews reviews;
 @Value("${food.demo-enabled:false}") private boolean demo;
 @Value("${food.appid:}") private String appid;
 @Value("${food.secret:}") private String secret;
 public FoodController(JdbcTemplate db,FoodSupport support,FoodOrders orders,FoodMemberService members,FoodRefunds refunds,FoodReviews reviews){this.reviews=reviews;this.refunds=refunds;this.db=db;this.support=support;this.orders=orders;this.members=members;}
 @GetMapping("/config") public AjaxResult config(){return AjaxResult.success(Map.of("demoEnabled",demo,"brand","青禾校园"));}
 @PostMapping("/logout") public AjaxResult logout(HttpServletRequest request){support.logout(request);return AjaxResult.success();}
 @PostMapping("/login") public AjaxResult login(@RequestBody Map<String,String> input,HttpServletRequest request){
   support.limit("login:"+request.getRemoteAddr(),30,60);
   String openid;
   if("demo".equals(input.get("mode"))){
     require(demo,"演示登录未启用");
     if(input.get("demoCredential")!=null){
       long id=support.demoMember(input.get("demoCredential"));
       require(db.queryForObject("SELECT COUNT(*) FROM food_member WHERE id=? AND openid LIKE 'demo:%'",Integer.class,id)==1,"演示账号不存在");
       return AjaxResult.success(Map.of("token",support.session(id),"memberId",id,"demoCredential",support.demoCredential(id)));
     }
     openid="demo:"+UUID.randomUUID();
   }
   else {
     require(!appid.isBlank()&&!secret.isBlank(),"请配置微信 AppSecret，或使用演示登录");
     require(input.get("code")!=null && input.get("code").length()<200,"缺少微信登录凭证");
     Map<?,?> data=RestClient.create("https://api.weixin.qq.com").get().uri(b->b.path("/sns/jscode2session").queryParam("appid",appid).queryParam("secret",secret).queryParam("js_code",input.get("code")).queryParam("grant_type","authorization_code").build()).retrieve().body(Map.class);
     require(data!=null && data.get("openid")!=null,"微信登录失败，请重试");openid=data.get("openid").toString();
   }
   long id=members.login(openid);var result=new HashMap<String,Object>();result.put("token",support.session(id));result.put("memberId",id);if(openid.startsWith("demo:"))result.put("demoCredential",support.demoCredential(id));return AjaxResult.success(result);
 }
 @GetMapping("/stores") public AjaxResult stores(){return AjaxResult.success(support.cache("stores",()->db.queryForList("SELECT s.*,(SELECT GROUP_CONCAT(p.name SEPARATOR ' ') FROM food_product p WHERE p.store_id=s.id AND p.active=1) search_keywords FROM food_store s WHERE s.active=1 ORDER BY s.sales DESC")));}
 @GetMapping("/stores/{id}") public AjaxResult store(@PathVariable long id){return AjaxResult.success(support.cache("store:"+id,()->{
   List<Map<String,Object>> rows=db.queryForList("SELECT * FROM food_store WHERE id=? AND active=1",id);require(!rows.isEmpty(),"商家不存在或休息中");
   Map<String,Object> data=rows.get(0);data.put("products",db.queryForList("SELECT * FROM food_product WHERE store_id=? AND active=1 ORDER BY id",id));return data;
 }));}
 @GetMapping("/stores/{id}/reviews") public AjaxResult reviews(@PathVariable long id){return AjaxResult.success(db.queryForList("SELECT r.id,r.rating,r.content,r.created_at,r.reply,r.replied_at,m.nickname FROM food_review r JOIN food_member m ON m.id=r.member_id WHERE r.store_id=? ORDER BY r.id DESC LIMIT 50",id));}
 @GetMapping("/me") public AjaxResult me(HttpServletRequest r){long id=support.member(r);Map<String,Object> m=db.queryForMap("SELECT id,nickname,points FROM food_member WHERE id=?",id);if(demo&&db.queryForObject("SELECT COUNT(*) FROM food_member WHERE id=? AND openid LIKE 'demo:%'",Integer.class,id)==1)m.put("demoCredential",support.demoCredential(id));m.put("coupons",db.queryForObject("SELECT COUNT(*) FROM food_coupon WHERE member_id=? AND used_order IS NULL AND expires_at>NOW()",Integer.class,id));m.put("checkedIn",db.queryForObject("SELECT COUNT(*) FROM food_checkin WHERE member_id=? AND day=CURRENT_DATE",Integer.class,id)>0);return AjaxResult.success(m);}
 @PostMapping("/checkin") public AjaxResult checkin(HttpServletRequest r){members.checkin(support.member(r));return AjaxResult.success();}
 @PostMapping("/redeem") public AjaxResult redeem(HttpServletRequest r){long id=support.member(r);support.limit("redeem:"+id,3,60);members.redeem(id);return AjaxResult.success();}
 @GetMapping("/coupons") public AjaxResult coupons(HttpServletRequest r){return AjaxResult.success(db.queryForList("SELECT * FROM food_coupon WHERE member_id=? AND used_order IS NULL AND expires_at>NOW() ORDER BY amount DESC",support.member(r)));}
 @GetMapping("/addresses") public AjaxResult addresses(HttpServletRequest r){return AjaxResult.success(db.queryForList("SELECT * FROM food_address WHERE member_id=? ORDER BY id DESC",support.member(r)));}
 @PostMapping("/addresses") public AjaxResult saveAddress(@RequestBody Map<String,Object> a,HttpServletRequest r){
   long member=support.member(r);String contact=text(a,"contact").trim(),phone=text(a,"phone").trim(),detail=text(a,"detail").trim();
   require(!contact.isEmpty() && contact.length()<=50,"请填写联系人（最多50字）");require(phone.matches("1[3-9][0-9]{9}"),"请输入正确的手机号");require(detail.length()>=3&&detail.length()<=250,"请填写详细地址（3至250字）");
   Double latitude=FoodLocationController.coordinate(a.get("latitude"),90),longitude=FoodLocationController.coordinate(a.get("longitude"),180);require((latitude==null)==(longitude==null),"收货点经纬度必须一起填写");
   if(a.get("id")!=null)require(db.update("UPDATE food_address SET contact=?,phone=?,detail=?,latitude=?,longitude=? WHERE id=? AND member_id=?",contact,phone,detail,latitude,longitude,a.get("id"),member)==1,"地址不存在");
   else {require(db.queryForObject("SELECT COUNT(*) FROM food_address WHERE member_id=?",Integer.class,member)<20,"最多保存20个地址");db.update("INSERT INTO food_address(member_id,contact,phone,detail,latitude,longitude) VALUES(?,?,?,?,?,?)",member,contact,phone,detail,latitude,longitude);}
   return AjaxResult.success();
 }
 @DeleteMapping("/addresses/{id}") public AjaxResult deleteAddress(@PathVariable long id,HttpServletRequest r){db.update("DELETE FROM food_address WHERE id=? AND member_id=?",id,support.member(r));return AjaxResult.success();}
 @PostMapping("/orders") public AjaxResult create(@RequestBody FoodOrders.Checkout c,HttpServletRequest r){long id=support.member(r);support.limit("order:"+id,30,60);try{return AjaxResult.success(orders.create(id,c));}catch(com.ruoyi.common.exception.ServiceException e){return AjaxResult.warn(e.getMessage());}}
 @GetMapping("/orders") public AjaxResult list(@RequestParam(defaultValue="1") int page,@RequestParam(defaultValue="") String type,@RequestParam(defaultValue="") String status,HttpServletRequest r){
   long member=support.member(r);require(page>=1&&page<=10000,"页码超出允许范围");
   require(type.isEmpty()||Set.of("DELIVERY","PICKUP").contains(type),"无效的配送方式");
   require(status.isEmpty()||Set.of("UNPAID","PENDING","PREPARING","WAITING_DELIVERY","DELIVERING","READY","COMPLETED","CANCELLED","REFUNDED").contains(status),"无效的订单状态");
   String filter=" WHERE o.member_id=?";List<Object> args=new ArrayList<>();args.add(member);
   if(!type.isEmpty()){filter+=" AND o.type=?";args.add(type);}
   if(!status.isEmpty()){filter+=" AND o.status=?";args.add(status);}
   args.add((page-1)*20);
   List<Map<String,Object>> list=db.queryForList("SELECT o.*,s.name store_name,s.image store_image FROM food_order o JOIN food_store s ON s.id=o.store_id"+filter+" ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET ?",args.toArray());
   if(!list.isEmpty()){
     // Fetch all items in one query instead of one additional query per order.
     Map<String,List<Map<String,Object>>> items=new HashMap<>();
     for(var order:list)items.put(text(order,"id"),new ArrayList<>());
     String placeholders=String.join(",",Collections.nCopies(list.size(),"?"));
     for(var item:db.queryForList("SELECT * FROM food_order_item WHERE order_id IN ("+placeholders+") ORDER BY id",list.stream().map(o->o.get("id")).toArray()))items.get(text(item,"order_id")).add(item);
     for(var order:list)order.put("items",items.get(text(order,"id")));
   }
   return AjaxResult.success(list);
 }
 @GetMapping("/orders/by-request/{key}") public AjaxResult recover(@PathVariable String key,HttpServletRequest r){long member=support.member(r);require(key.matches("[A-Za-z0-9-]{16,80}"),"无效请求编号");var ids=db.queryForList("SELECT id FROM food_order WHERE member_id=? AND request_key=?",String.class,member,key);return AjaxResult.success(ids.isEmpty()?Map.of("found",false):Map.of("found",true,"order",orders.detail(member,ids.get(0))));}
 @PostMapping("/orders/{id}/refund") public AjaxResult refund(@PathVariable String id,@RequestBody FoodRefunds.Request body,HttpServletRequest r){require(demo,"当前仅支持模拟退款");refunds.request(support.member(r),id,body);return AjaxResult.success();}
 @PostMapping("/orders/{id}/refund-quote") public AjaxResult quote(@PathVariable String id,@RequestBody FoodRefunds.Request body,HttpServletRequest r){return AjaxResult.success(refunds.quote(support.member(r),id,body));}
 @GetMapping("/orders/{id}") public AjaxResult detail(@PathVariable String id,HttpServletRequest r){return AjaxResult.success(orders.detail(support.member(r),id));}
 @PostMapping("/orders/{id}/pay") public AjaxResult pay(@PathVariable String id,HttpServletRequest r){require(demo,"模拟支付未启用，真实支付尚未接入");orders.transition(id,support.member(r),"PENDING");return AjaxResult.success();}
 @PostMapping("/orders/{id}/cancel") public AjaxResult cancel(@PathVariable String id,HttpServletRequest r){orders.transition(id,support.member(r),"CANCELLED");return AjaxResult.success();}
 @PostMapping("/orders/{id}/complete") public AjaxResult complete(@PathVariable String id,HttpServletRequest r){orders.transition(id,support.member(r),"COMPLETED");return AjaxResult.success();}
 @PostMapping("/orders/{id}/review") public AjaxResult review(@PathVariable String id,@RequestBody Map<String,Object> input,HttpServletRequest r){reviews.submit(support.member(r),id,input);return AjaxResult.success();}
 @GetMapping("/feedback") public AjaxResult feedback(HttpServletRequest r){return AjaxResult.success(db.queryForList("SELECT * FROM food_feedback WHERE member_id=? ORDER BY id DESC LIMIT 50",support.member(r)));}
 @PostMapping("/feedback") public AjaxResult feedback(@RequestBody Map<String,Object> body,HttpServletRequest r){long id=support.member(r);support.limit("feedback:"+id,5,60);String content=text(body,"content").trim();require(content.length()>=5&&content.length()<=1000,"请输入5至1000字反馈");db.update("INSERT INTO food_feedback(member_id,content) VALUES(?,?)",id,content);return AjaxResult.success();}
}
