package com.ruoyi.food;

import com.ruoyi.common.exception.ServiceException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.Instant;
import java.time.Duration;
import java.util.*;
import java.util.function.Supplier;

@Component
public class FoodSupport {
    @org.springframework.beans.factory.annotation.Value("${token.secret}") private String signingKey;
    final StringRedisTemplate redis;
    final ObjectMapper json;
    private final JdbcTemplate db;
    public FoodSupport(StringRedisTemplate redis, ObjectMapper json, JdbcTemplate db) { this.redis=redis; this.json=json; this.db=db; }
    public static void require(boolean ok, String message) { if(!ok) throw new ServiceException(message); }
    /** Nginx overwrites X-Real-IP with the peer address; the backend only binds to 127.0.0.1. */
    public static String clientIp(HttpServletRequest request) {
        String ip=request.getHeader("X-Real-IP");
        if(ip==null||ip.isBlank()) return request.getRemoteAddr();
        ip=ip.trim();
        return ip.matches("[0-9a-fA-F:.]{2,45}")?ip:request.getRemoteAddr();
    }
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
    public void logout(HttpServletRequest request, String credential) {
        String token=request.getHeader("X-Food-Token");
        String id=token==null?null:redis.opsForValue().get("food:session:"+token);
        // A saved recovery credential can also revoke recovery after the session expires.
        Long member=id==null?null:Long.valueOf(id);
        if(member==null&&credential!=null&&!credential.isBlank()) {
            try { member=demoMember(credential); } catch(ServiceException ignored) { /* Already revoked or expired. */ }
        }
        if(member!=null)db.update("UPDATE food_member SET recovery_version=recovery_version+1 WHERE id=?",member);
        if(token!=null&&!token.isBlank())redis.delete("food:session:"+token);
    }
    // Call inside the login/me transaction. The member lock serializes issuance and logout.
    public String demoCredential(long member) {
        long version=db.queryForObject("SELECT recovery_version FROM food_member WHERE id=? FOR UPDATE",Long.class,member);
        String value="v2."+member+"."+version+"."+Instant.now().plus(Duration.ofDays(30)).getEpochSecond()+"."+UUID.randomUUID().toString().replace("-","");
        return value+"."+demoSignature(value);
    }
    private String demoSignature(String value) {
        try {
            var mac=javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(signingKey.getBytes(java.nio.charset.StandardCharsets.UTF_8),"HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(("food-demo:"+value).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch(java.security.GeneralSecurityException e) {throw new IllegalStateException(e);}
    }
    public long demoMember(String credential) {
        require(credential!=null&&credential.matches("v2\\.[1-9][0-9]{0,17}\\.[0-9]{1,18}\\.[0-9]{1,12}\\.[a-f0-9]{32}\\.[a-f0-9]{64}"),"演示账号恢复凭证无效，请退出后重新登录");
        int split=credential.lastIndexOf('.');String value=credential.substring(0,split);
        require(java.security.MessageDigest.isEqual(demoSignature(value).getBytes(java.nio.charset.StandardCharsets.UTF_8),credential.substring(split+1).getBytes(java.nio.charset.StandardCharsets.UTF_8)),"演示账号恢复凭证无效");
        String[] parts=value.split("\\.");long member=Long.parseLong(parts[1]);
        require(Long.parseLong(parts[3])>Instant.now().getEpochSecond(),"演示账号恢复凭证已过期，请退出后重新登录");
        var versions=db.queryForList("SELECT recovery_version FROM food_member WHERE id=? AND openid LIKE 'demo:%' FOR UPDATE",Long.class,member);
        require(!versions.isEmpty()&&versions.get(0)==Long.parseLong(parts[2]),"演示账号恢复凭证已撤销，请退出后重新登录");
        return member;
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
