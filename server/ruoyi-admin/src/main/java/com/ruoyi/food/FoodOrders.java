package com.ruoyi.food;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;

@Service
public class FoodOrders {
    private final JdbcTemplate db;
    public FoodOrders(JdbcTemplate db) {this.db=db;}
    public record Line(long productId,int quantity,Long specId,List<Long> addonIds) {}
    public record Checkout(long storeId,String type,Long addressId,Long couponId,String remark,String requestKey,List<Line> items,Integer expectedTotal,String scheduledAt) {}
    private String fingerprint(Checkout c,Object items) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((c.storeId()+"|"+c.type()+"|"+c.addressId()+"|"+c.couponId()+"|"+c.remark()+"|"+items+(c.expectedTotal()==null?"":"|expectedTotal="+c.expectedTotal())+(c.scheduledAt()==null||c.scheduledAt().isBlank()?"":"|scheduled="+c.scheduledAt())).getBytes(StandardCharsets.UTF_8))); }
        catch(Exception e) {throw new IllegalStateException(e);}
    }
    @Transactional
    public Map<String,Object> create(long member,Checkout c) {
        require(c.items()!=null && !c.items().isEmpty() && c.items().size()<=50,"请选择商品（最多50种）");
        require(c.requestKey()!=null && c.requestKey().matches("[A-Za-z0-9-]{16,80}"),"无效的请求标识");
        require(Set.of("DELIVERY","PICKUP").contains(Objects.toString(c.type(),"")),"无效的配送方式");
        require(c.remark()==null || c.remark().length()<=200,"备注过长");
        TreeMap<Long,Integer> totals=new TreeMap<>();TreeMap<String,Line> lines=new TreeMap<>();
        for(Line l:c.items()){
            require(l!=null&&l.productId()>0&&l.quantity()>0&&l.quantity()<=99,"无效的商品或数量");
            List<Long> adds=l.addonIds()==null?List.of():l.addonIds();require(adds.size()<=10&&adds.stream().allMatch(v->v!=null&&v>0)&&new HashSet<>(adds).size()==adds.size(),"加料选项最多10种且不能重复");require(l.specId()==null||l.specId()>0,"无效规格");
            adds=adds.stream().sorted().toList();String k=l.productId()+":"+l.specId()+":"+adds;Line previous=lines.get(k);lines.put(k,new Line(l.productId(),l.quantity()+(previous==null?0:previous.quantity()),l.specId(),adds));totals.merge(l.productId(),l.quantity(),Integer::sum);
        }
        totals.values().forEach(q->require(q<=99,"同一菜品合计不能超过99份"));
        List<Line> items=lines.values().stream().sorted(Comparator.comparingLong(Line::productId).thenComparing(l->Objects.toString(l.specId(),"")).thenComparing(l->l.addonIds().toString())).toList();
        String hash=fingerprint(c,items.stream().allMatch(l->l.specId()==null&&l.addonIds().isEmpty())?totals:lines.toString());
        String id="MX"+UUID.randomUUID().toString().replace("-","");
        // Unique idempotency key is acquired before stock locks. A concurrent duplicate waits for commit.
        db.update("INSERT INTO food_order(id,member_id,store_id,request_key,request_hash,type,remark,pickup_code,expires_at) VALUES(?,?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE request_key=request_key",id,member,c.storeId(),c.requestKey(),hash,c.type(),Objects.toString(c.remark(),""),String.format("%06d",new java.security.SecureRandom().nextInt(1000000)));
        Map<String,Object> existing=db.queryForMap("SELECT * FROM food_order WHERE member_id=? AND request_key=? FOR UPDATE",member,c.requestKey());
        require(hash.equals(existing.get("request_hash")),"同一请求标识不能用于不同订单");
        if(!id.equals(existing.get("id"))) return detail(member,text(existing,"id"));
        List<Map<String,Object>> stores=db.queryForList("SELECT * FROM food_store WHERE id=? AND active=1",c.storeId());
        require(!stores.isEmpty(),"商家已休息");
        Map<String,Object> store=stores.get(0);
        var scheduled=FoodReservations.parse(store,c.scheduledAt());
        if(scheduled==null)FoodBusinessRules.requireOpen(store);
        else db.update("UPDATE food_order SET scheduled_at=?,prepare_at=? WHERE id=?",scheduled,scheduled.minusMinutes(number(store,"lead_minutes")),id);
        String address="到店自取";
        if(c.type().equals("DELIVERY")) {
            List<Map<String,Object>> addresses=db.queryForList("SELECT * FROM food_address WHERE id=? AND member_id=?",c.addressId(),member);
            require(!addresses.isEmpty(),"请选择自己的收货地址");
            Map<String,Object> a=addresses.get(0);FoodBusinessRules.requireDelivery(store,a); address=a.get("contact")+" / "+a.get("phone")+" / "+a.get("detail");
        }
        int subtotal=0;
        // Deterministic product lock order prevents inverted multi-item lock deadlocks.
        for(Line entry:items) {
            List<Map<String,Object>> products=db.queryForList("SELECT * FROM food_product WHERE id=? AND store_id=? FOR UPDATE",entry.productId(),c.storeId());
            require(!products.isEmpty(),"商品不属于当前商家");
            Map<String,Object> p=products.get(0); int quantity=entry.quantity();
            require(db.update("UPDATE food_product SET stock=stock-?,version=version+1 WHERE id=? AND stock>=? AND active=1",quantity,entry.productId(),quantity)==1,text(p,"name")+"库存不足或已下架");
            var options=db.queryForList("SELECT * FROM food_product_option WHERE product_id=? AND active=1 ORDER BY id FOR UPDATE",entry.productId());
            boolean hasSpecs=options.stream().anyMatch(o->"SPEC".equals(o.get("kind")));require(!hasSpecs||entry.specId()!=null,"请选择菜品规格");
            TreeSet<Long> selected=new TreeSet<>(entry.addonIds());if(entry.specId()!=null)require(selected.add(entry.specId()),"规格与加料不能重复");
            int price=Math.toIntExact(number(p,"price"));List<String> labels=new ArrayList<>();
            if(entry.specId()!=null){var spec=options.stream().filter(o->number(o,"id")==entry.specId()&&"SPEC".equals(o.get("kind"))).findFirst();require(spec.isPresent(),"所选规格已下架或不属于本菜品");price=Math.toIntExact(number(spec.get(),"price"));}
            for(long optionId:selected){var chosen=options.stream().filter(o->number(o,"id")==optionId).findFirst();require(chosen.isPresent(),"所选加料已下架或不属于本菜品");var o=chosen.get();if(!Objects.equals(entry.specId(),optionId)){require("ADDON".equals(o.get("kind")),"加料类型不正确");price=Math.addExact(price,Math.toIntExact(number(o,"price")));}labels.add(text(o,"name"));require(db.update("UPDATE food_product_option SET stock=stock-?,version=version+1 WHERE id=? AND stock>=? AND active=1",quantity,optionId,quantity)==1,"规格或加料库存不足");}
            long sum=(long)subtotal+(long)price*quantity;require(sum<=100000000,"订单金额过大，请分开下单");subtotal=(int)sum;
            db.update("INSERT INTO food_order_item(order_id,product_id,name,image,price,quantity,option_ids,option_text) VALUES(?,?,?,?,?,?,?,?)",id,entry.productId(),p.get("name"),p.get("image"),price,quantity,String.join(",",selected.stream().map(Object::toString).toList()),String.join(" / ",labels));
        }
        require(subtotal>=number(store,"minimum") || c.type().equals("PICKUP"),"未达到起送金额");
        int discount=0;
        if(c.couponId()!=null) {
            List<Map<String,Object>> coupons=db.queryForList("SELECT * FROM food_coupon WHERE id=? AND member_id=? AND used_order IS NULL AND expires_at>NOW() FOR UPDATE",c.couponId(),member);
            require(!coupons.isEmpty(),"优惠券已使用或已过期"); Map<String,Object> coupon=coupons.get(0);
            require(subtotal>=number(coupon,"minimum"),"未达到优惠券使用门槛");
            discount=(int)Math.min(subtotal,number(coupon,"amount"));
            db.update("UPDATE food_coupon SET used_order=? WHERE id=?",id,c.couponId());
        }
        int fee=c.type().equals("DELIVERY")?(int)number(store,"delivery_fee"):0;
        // An outdated client amount must never silently create a differently priced order.
        require(c.expectedTotal()==null || c.expectedTotal()==subtotal+fee-discount,"价格或配送费发生变化，请返回店铺刷新后重新确认");
        db.update("UPDATE food_order SET subtotal=?,delivery_fee=?,discount=?,total=?,coupon_id=?,address=? WHERE id=?",subtotal,fee,discount,subtotal+fee-discount,c.couponId(),address,id);
        return detail(member,id);
    }
    public Map<String,Object> detail(long member,String id) {
        List<Map<String,Object>> list=db.queryForList("SELECT o.*,s.name store_name,s.image store_image FROM food_order o JOIN food_store s ON s.id=o.store_id WHERE o.id=? AND o.member_id=?",id,member);
        require(!list.isEmpty(),"订单不存在");
        Map<String,Object> result=list.get(0);
        result.put("items",db.queryForList("SELECT * FROM food_order_item WHERE order_id=?",id));
        result.put("refunds",db.queryForList("SELECT * FROM food_refund WHERE order_id=? ORDER BY requested_at DESC,id DESC",id));
        return result;
    }
    void restore(Map<String,Object> order){
        for(var item:db.queryForList("SELECT * FROM food_order_item WHERE order_id=? ORDER BY product_id,id",order.get("id"))){
            db.update("UPDATE food_product SET stock=stock+?,version=version+1 WHERE id=?",item.get("quantity"),item.get("product_id"));
            if(!text(item,"option_ids").isEmpty())for(String option:text(item,"option_ids").split(","))db.update("UPDATE food_product_option SET stock=stock+?,version=version+1 WHERE id=?",item.get("quantity"),Long.parseLong(option));
        }
        db.update("UPDATE food_coupon SET used_order=NULL WHERE used_order=?",order.get("id"));
    }
    @Transactional
    public void transition(String id,Long member,String target) {
        List<Map<String,Object>> rows=db.queryForList("SELECT *,expires_at<=NOW() expired FROM food_order WHERE id=? FOR UPDATE",id);
        require(!rows.isEmpty(),"订单不存在"); Map<String,Object> order=rows.get(0);
        require(member==null || number(order,"member_id")==member,"订单不存在");
        String status=text(order,"status");
        if(status.equals(target)) return;
        require(!"REQUESTED".equals(order.get("refund_status")),"请先处理退款申请");
        if(target.equals("PREPARING"))require(order.get("prepare_at")==null||!java.time.LocalDateTime.parse(order.get("prepare_at").toString().replace(" ","T")).isAfter(java.time.LocalDateTime.now(FoodReservations.ZONE)),"预约单尚未到备餐时间");
        boolean expired=((Number)order.get("expired")).intValue()==1;
        if(target.equals("PENDING")) require(status.equals("UNPAID")&&!expired,"订单已过期或不能支付");
        else if(target.equals("CANCELLED")) require(status.equals("UNPAID"),"只有未支付订单可以取消");
        else {
            String next=switch(status){case "PENDING"->"PREPARING";case "PREPARING"->text(order,"type").equals("PICKUP")?"READY":"DELIVERING";case "READY","DELIVERING"->"COMPLETED";default->"";};
            require(next.equals(target)||(status.equals("PREPARING")&&text(order,"type").equals("DELIVERY")&&target.equals("WAITING_DELIVERY")),"订单状态不能跳转");
            require(member==null || target.equals("COMPLETED"),"无权操作订单状态");
        }
        db.update("UPDATE food_order SET status=?,paid_at=IF(?='PENDING',NOW(),paid_at),completed_at=IF(?='COMPLETED',NOW(),completed_at) WHERE id=?",target,target,target,id);
        if(target.equals("CANCELLED")) {
            restore(order);
        }
        if(target.equals("COMPLETED")) {
            db.update("UPDATE food_member SET points=points+? WHERE id=?",number(order,"total")/100,order.get("member_id"));
            db.update("UPDATE food_store SET sales=sales+1 WHERE id=?",order.get("store_id"));
            for(Map<String,Object> item:db.queryForList("SELECT * FROM food_order_item WHERE order_id=? ORDER BY product_id",id)) db.update("UPDATE food_product SET sales=sales+? WHERE id=?",item.get("quantity"),item.get("product_id"));
        }
    }
}
