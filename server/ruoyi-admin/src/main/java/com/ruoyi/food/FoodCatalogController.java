package com.ruoyi.food;

import com.ruoyi.common.annotation.Anonymous;
import com.ruoyi.common.core.domain.AjaxResult;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import static com.ruoyi.food.FoodSupport.*;

@RestController
public class FoodCatalogController {
    private final JdbcTemplate db;private final FoodScope scope;private final FoodOptions options;private final FoodReservationStock reservations;
    public FoodCatalogController(JdbcTemplate db,FoodScope scope,FoodOptions options,FoodReservationStock reservations){this.reservations=reservations;this.options=options;this.db=db;this.scope=scope;}
    private int integer(Map<String,String> p,String key,int fallback,int max){try{int n=Integer.parseInt(p.getOrDefault(key,""+fallback));require(n>=1&&n<=max,"分页参数不合法");return n;}catch(NumberFormatException e){throw new com.ruoyi.common.exception.ServiceException("分页参数不合法");}}
    private String keyword(Map<String,String> p,String key){String s=p.getOrDefault(key,"").trim();require(s.length()<=80,"搜索内容过长");return s;}
    private String like(String s){return "%"+s.replace("!","!!").replace("%","!%").replace("_","!_")+"%";}
    @Anonymous @GetMapping("/food/app/catalog/stores") public AjaxResult publicStores(@RequestParam Map<String,String> p){return stores(p,false);}
    @PreAuthorize("@ss.hasPermi('food:manage')") @GetMapping("/food/admin/catalog/stores") public AjaxResult adminStores(@RequestParam Map<String,String> p){return stores(p,true);}
    private AjaxResult stores(Map<String,String> p,boolean admin){
        int page=integer(p,"page",1,10000),size=integer(p,"pageSize",20,100);List<Object> a=new ArrayList<>();
        String where=" WHERE "+(admin?scope.condition("s.id"):"s.active=1");
        String q=keyword(p,"q");if(!q.isEmpty()){
            where+=" AND (s.name LIKE ? ESCAPE '!' OR s.description LIKE ? ESCAPE '!' OR s.category LIKE ? ESCAPE '!'";a.add(like(q));a.add(like(q));a.add(like(q));
            if(!admin){where+=" OR EXISTS(SELECT 1 FROM food_product p WHERE p.store_id=s.id AND p.active=1 AND p.name LIKE ? ESCAPE '!')";a.add(like(q));}where+=")";
        }
        for(String field:List.of("zone","category")){String value=keyword(p,field);if(!value.isEmpty()){where+=" AND s."+field+"=?";a.add(value);}}
        if("true".equals(p.get("lowFee")))where+=" AND s.delivery_fee<=100";
        long count=db.queryForObject("SELECT COUNT(*) FROM food_store s"+where,Long.class,a.toArray());
        String sort=p.getOrDefault("sort","recommended"),order=admin?"s.id DESC":"s.rating DESC,s.sales DESC,s.id";
        require(Set.of("recommended","sales","distance").contains(sort),"无效的排序方式");
        if(sort.equals("sales"))order="s.sales DESC,s.id";
        if(sort.equals("distance")){
            Double lat=FoodLocationController.coordinate(p.get("latitude"),90),lng=FoodLocationController.coordinate(p.get("longitude"),180);require(lat!=null&&lng!=null,"请先定位再按距离排序");
            order="(s.latitude IS NULL OR s.longitude IS NULL),ACOS(LEAST(1,GREATEST(-1,SIN(RADIANS(s.latitude))*SIN(RADIANS(?))+COS(RADIANS(s.latitude))*COS(RADIANS(?))*COS(RADIANS(s.longitude-?))))),s.id";a.add(lat);a.add(lat);a.add(lng);
        }
        a.add(size);a.add((page-1)*size);
        String columns=admin?"s.*,(SELECT GROUP_CONCAT(u.user_name) FROM food_store_user su JOIN sys_user u ON u.user_id=su.user_id WHERE su.store_id=s.id) accounts":"s.*";
        var rows=db.queryForList("SELECT "+columns+" FROM food_store s"+where+" ORDER BY "+order+" LIMIT ? OFFSET ?",a.toArray());rows.forEach(FoodBusinessRules::decorate);
        return AjaxResult.success(Map.of("rows",rows,"total",count,"page",page,"pageSize",size));
    }
    @Anonymous @GetMapping("/food/app/catalog/products") public AjaxResult publicProducts(@RequestParam Map<String,String> p){return products(p,false);}
    @PreAuthorize("@ss.hasPermi('food:manage')") @GetMapping("/food/admin/catalog/products") public AjaxResult adminProducts(@RequestParam Map<String,String> p){return products(p,true);}
    private AjaxResult products(Map<String,String> p,boolean admin){
        int page=integer(p,"page",1,10000),size=integer(p,"pageSize",20,100);List<Object> a=new ArrayList<>();
        String where=" WHERE "+(admin?scope.condition("p.store_id"):"p.active=1 AND s.active=1");
        if(!p.getOrDefault("storeId","").isBlank()){int store=integer(p,"storeId",0,Integer.MAX_VALUE);if(admin)scope.store(store);where+=" AND p.store_id=?";a.add(store);}
        else require(admin,"请选择商家");
        String q=keyword(p,"q");if(!q.isEmpty()){where+=" AND (p.name LIKE ? ESCAPE '!' OR p.description LIKE ? ESCAPE '!' OR s.name LIKE ? ESCAPE '!')";a.add(like(q));a.add(like(q));a.add(like(q));}
        String category=keyword(p,"category");if(!category.isEmpty()){where+=" AND p.category=?";a.add(category);}
        String ids=p.getOrDefault("ids","");if(!ids.isEmpty()){
            String[] parts=ids.split(",",-1);require(parts.length<=50,"最多查询50种菜品");List<Long> parsed=new ArrayList<>();
            for(String part:parts){require(part.matches("[0-9]{1,15}"),"商品编号格式不正确");parsed.add(Long.parseLong(part));}
            where+=" AND p.id IN ("+String.join(",",Collections.nCopies(parsed.size(),"?"))+")";a.addAll(parsed);
        }
        String from=" FROM food_product p JOIN food_store s ON s.id=p.store_id";
        long count=db.queryForObject("SELECT COUNT(*)"+from+where,Long.class,a.toArray());a.add(size);a.add((page-1)*size);
        var rows=db.queryForList("SELECT p.*,s.name store_name"+from+where+" ORDER BY p.id "+(admin?"DESC":"ASC")+" LIMIT ? OFFSET ?",a.toArray());
        options.attach(rows);if(!admin&&!p.getOrDefault("scheduledAt","").isBlank()){var stores=db.queryForList("SELECT * FROM food_store WHERE id=?",Long.parseLong(p.get("storeId")));require(!stores.isEmpty(),"商家不存在");var slot=FoodReservations.parse(stores.get(0),p.get("scheduledAt"));reservations.decorate(rows,slot.toLocalDate());}if(!admin){var when=p.getOrDefault("scheduledAt","").isBlank()?FoodSelling.now():FoodSelling.time(p.get("scheduledAt"));rows.forEach(row->FoodSelling.decorate(row,when));}return AjaxResult.success(Map.of("rows",rows,"total",count,"page",page,"pageSize",size));
    }
    @Anonymous @GetMapping("/food/app/stores/{id}/slots") public AjaxResult slots(@PathVariable long id){var rows=db.queryForList("SELECT * FROM food_store WHERE id=? AND active=1",id);require(!rows.isEmpty(),"店铺已休息");return AjaxResult.success(reservations.slots(rows.get(0)));}
    @Anonymous @GetMapping("/food/app/catalog/zones") public AjaxResult zones(){return AjaxResult.success(db.queryForList("SELECT DISTINCT zone FROM food_store WHERE active=1 ORDER BY zone",String.class));}
    @Anonymous @GetMapping("/food/app/stores/{id}/info") public AjaxResult info(@PathVariable long id){
        var rows=db.queryForList("SELECT * FROM food_store WHERE id=? AND active=1",id);require(!rows.isEmpty(),"商家不存在或休息中");var store=FoodBusinessRules.decorate(rows.get(0));
        store.put("categories",db.queryForList("SELECT DISTINCT category FROM food_product WHERE store_id=? AND active=1 ORDER BY category",String.class,id));return AjaxResult.success(store);
    }
}
