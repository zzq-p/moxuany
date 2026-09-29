package com.ruoyi.food;
import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.annotation.Log;
import com.ruoyi.common.enums.BusinessType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;
@RestController @RequestMapping("/food/admin/reports") @PreAuthorize("@ss.hasPermi('food:reports')")
public class FoodReportsController {
 private final JdbcTemplate db;private final FoodScope scope;
 public FoodReportsController(JdbcTemplate db,FoodScope scope){this.db=db;this.scope=scope;}
 private Object[] range(String from,String to){try{LocalDate a=LocalDate.parse(from),b=LocalDate.parse(to);require(!b.isBefore(a)&&ChronoUnit.DAYS.between(a,b)<31,"请选择不超过31天的日期范围");return new Object[]{a.atStartOfDay(),b.plusDays(1).atStartOfDay()};}catch(java.time.format.DateTimeParseException e){throw new com.ruoyi.common.exception.ServiceException("日期格式须为YYYY-MM-DD");}}
 private String filter(){return " WHERE o.created_at>=? AND o.created_at<? AND "+scope.condition("o.store_id");}
 @GetMapping public AjaxResult report(@RequestParam String from,@RequestParam String to){Object[] a=range(from,to);String metrics="COUNT(*) orders,COALESCE(SUM(o.status='CANCELLED'),0) cancelled,COALESCE(SUM(o.status='REFUNDED'),0) refunded,COALESCE(SUM(IF(o.paid_at IS NOT NULL,o.total,0)),0) gross,COALESCE(SUM(IF(o.status='REFUNDED',o.total,0)),0) refunds,COALESCE(SUM(IF(o.paid_at IS NOT NULL AND o.status<>'REFUNDED',o.total,0)),0) revenue";var summary=db.queryForMap("SELECT "+metrics+" FROM food_order o"+filter(),a);summary.put("cancelRate",number(summary,"orders")==0?0:Math.round(10000.0*number(summary,"cancelled")/number(summary,"orders"))/100.0);
  return AjaxResult.success(Map.of("summary",summary,"daily",db.queryForList("SELECT DATE(o.created_at) day,"+metrics+" FROM food_order o"+filter()+" GROUP BY DATE(o.created_at) ORDER BY day",a),"popular",db.queryForList("SELECT i.product_id,MAX(i.name) name,SUM(i.quantity) quantity,SUM(i.quantity*i.price) sales FROM food_order_item i JOIN food_order o ON o.id=i.order_id"+filter()+" AND o.paid_at IS NOT NULL AND o.status<>'REFUNDED' GROUP BY i.product_id ORDER BY quantity DESC,i.product_id LIMIT 20",a)));
 }
 @Log(title="导出经营订单",businessType=BusinessType.EXPORT) @GetMapping("/export") public AjaxResult export(@RequestParam String from,@RequestParam String to){Object[] a=range(from,to);long total=db.queryForObject("SELECT COUNT(*) FROM food_order o"+filter(),Long.class,a);require(total<=10000,"本次超过10000单，请缩小日期范围后导出");return AjaxResult.success(db.queryForList("SELECT o.id,s.name store_name,o.type,o.status,o.refund_status,o.subtotal,o.discount,o.delivery_fee,o.total,o.created_at,o.scheduled_at FROM food_order o JOIN food_store s ON s.id=o.store_id"+filter()+" ORDER BY o.created_at,o.id LIMIT 10000",a));}
}
