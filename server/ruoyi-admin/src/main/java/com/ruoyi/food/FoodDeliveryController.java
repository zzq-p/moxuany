package com.ruoyi.food;
import com.ruoyi.common.annotation.Log;
import com.ruoyi.common.enums.BusinessType;
import com.ruoyi.common.core.domain.AjaxResult;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;
@RestController @RequestMapping("/food/delivery") @PreAuthorize("@ss.hasPermi('food:delivery')")
public class FoodDeliveryController {
 private final FoodDelivery delivery;private final FoodScope scope;private final FoodMerchantAccounts accounts;private final JdbcTemplate db;
 public FoodDeliveryController(FoodDelivery delivery,FoodScope scope,FoodMerchantAccounts accounts,JdbcTemplate db){this.delivery=delivery;this.scope=scope;this.accounts=accounts;this.db=db;}
 @GetMapping("/orders") public AjaxResult list(@RequestParam(defaultValue="AVAILABLE")String mode,@RequestParam(defaultValue="1")int page){return AjaxResult.success(delivery.list(mode,page));}
 @Log(title="骑手接配送单",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/claim") public AjaxResult claim(@PathVariable String id){delivery.claim(id);return AjaxResult.success();}
 @Log(title="骑手确认送达",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/complete") public AjaxResult complete(@PathVariable String id){delivery.complete(id);return AjaxResult.success();}
 @GetMapping("/riders") public AjaxResult riders(){scope.platformOnly();return AjaxResult.success(db.queryForList("SELECT r.*,u.user_name,(SELECT COUNT(*) FROM food_order o WHERE o.rider_id=r.user_id AND o.status='DELIVERING') active_orders FROM food_rider_user r JOIN sys_user u ON u.user_id=r.user_id WHERE u.status='0' AND u.del_flag='0' ORDER BY r.user_id DESC LIMIT 500"));}
 public record Assignment(long riderId,long version,String reason){}
 @Log(title="配送异常上报",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/issue") public AjaxResult issue(@PathVariable String id,@RequestBody Map<String,String> body){delivery.issue(id,body.get("reason"));return AjaxResult.success();}
 @Log(title="平台配送转派",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/reassign") public AjaxResult reassign(@PathVariable String id,@RequestBody Assignment body){scope.platformOnly();delivery.reassign(id,body.riderId(),body.version(),body.reason());return AjaxResult.success();}
 @Log(title="平台配送异常处理",businessType=BusinessType.UPDATE) @PostMapping("/orders/{id}/resolve") public AjaxResult resolve(@PathVariable String id,@RequestBody Assignment body){scope.platformOnly();delivery.resolve(id,body.version(),body.reason());return AjaxResult.success();}
 @Log(title="骑手配送上限",businessType=BusinessType.UPDATE) @PostMapping("/riders/{id}/limit") public AjaxResult limit(@PathVariable long id,@RequestBody Map<String,Integer> body){scope.platformOnly();delivery.limit(id,body.get("maxActive"));return AjaxResult.success();}
 @Log(title="创建骑手账号",businessType=BusinessType.INSERT) @PostMapping("/riders") public AjaxResult create(@RequestBody Map<String,String> body){accounts.createRider(body.get("username"),body.get("password"),body.get("name"),body.get("phone"));return AjaxResult.success();}
 @Log(title="骑手启停",businessType=BusinessType.UPDATE) @PostMapping("/riders/{id}/active") public AjaxResult active(@PathVariable long id,@RequestBody Map<String,Integer> body){scope.platformOnly();delivery.active(id,body.get("active"));return AjaxResult.success();}
}
