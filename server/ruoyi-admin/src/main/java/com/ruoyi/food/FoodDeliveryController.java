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
 @GetMapping("/riders") public AjaxResult riders(){scope.platformOnly();return AjaxResult.success(db.queryForList("SELECT r.*,u.user_name FROM food_rider_user r JOIN sys_user u ON u.user_id=r.user_id ORDER BY r.user_id DESC LIMIT 500"));}
 @Log(title="创建骑手账号",businessType=BusinessType.INSERT) @PostMapping("/riders") public AjaxResult create(@RequestBody Map<String,String> body){accounts.createRider(body.get("username"),body.get("password"),body.get("name"),body.get("phone"));return AjaxResult.success();}
 @Log(title="骑手启停",businessType=BusinessType.UPDATE) @PostMapping("/riders/{id}/active") public AjaxResult active(@PathVariable long id,@RequestBody Map<String,Integer> body){scope.platformOnly();delivery.active(id,body.get("active"));return AjaxResult.success();}
}
