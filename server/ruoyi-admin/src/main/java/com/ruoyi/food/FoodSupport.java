package com.ruoyi.food;

import com.ruoyi.common.exception.ServiceException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.util.*;
import java.util.function.Supplier;

@Component
public class FoodSupport {
    final StringRedisTemplate redis;
    final ObjectMapper json;
    public FoodSupport(StringRedisTemplate redis, ObjectMapper json) { this.redis=redis; this.json=json; }
    public static void require(boolean ok, String message) { if(!ok) throw new ServiceException(message); }
    public static long number(Map<String,Object> row,String key) { return ((Number)row.get(key)).longValue(); }
    public static String text(Map<String,Object> row,String key) { return Objects.toString(row.get(key),""); }
    public long member(HttpServletRequest request) {
        String token=request.getHeader("X-Food-Token");
        String id=token==null?null:redis.opsForValue().get("food:session:"+token);
        if(id==null) throw new ServiceException("请先登录",401);
        return Long.parseLong(id);
    }
    public String session(long member) {
        String token=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");
        redis.opsForValue().set("food:session:"+token,Long.toString(member),Duration.ofDays(7));
        return token;
    }
    public void limit(String key,int max,int seconds) {
        Long n=redis.execute(new DefaultRedisScript<>("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",Long.class),List.of("food:rate:"+key),Integer.toString(seconds));
        if(n==null || n>max) throw new ServiceException("操作频繁，请稍后重试",429);
    }
    public Object cache(String key,Supplier<Object> fetch) {
        try { String value=redis.opsForValue().get("food:cache:"+key); if(value!=null) return json.readValue(value,Object.class); }
        catch(Exception ignored) { /* Catalog remains available if Redis is unavailable. */ }
        Object value=fetch.get();
        try { redis.opsForValue().set("food:cache:"+key,json.writeValueAsString(value),Duration.ofSeconds(30+new Random().nextInt(15))); } catch(Exception ignored) { }
        return value;
    }
    public void invalidate(long store) { redis.delete(List.of("food:cache:stores","food:cache:store:"+store)); }
}
