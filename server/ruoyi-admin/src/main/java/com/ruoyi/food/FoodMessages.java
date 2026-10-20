package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;

@Service
public class FoodMessages {
  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final TransactionTemplate tx;
  private final RestClient http;

  @Value("${food.appid:}")
  private String appid;

  @Value("${food.secret:}")
  private String secret;

  @Value("${food.subscriptions-enabled:false}")
  private boolean enabled;

  @Value("${food.message-environment:formal}")
  private String environment;

  private String token = "";
  private long tokenExpires;

  public FoodMessages(JdbcTemplate db, ObjectMapper json, TransactionTemplate tx) {
    this.db = db;
    this.json = json;
    this.tx = tx;
    var factory = new SimpleClientHttpRequestFactory();
    factory.setConnectTimeout(3000);
    factory.setReadTimeout(5000);
    http =
        RestClient.builder().baseUrl("https://api.weixin.qq.com").requestFactory(factory).build();
  }

  public boolean configured() {
    return enabled && !appid.isBlank() && !secret.isBlank();
  }

  String encode(Object v) {
    try {
      return json.writeValueAsString(v);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  Map<String, String> fields(String s) {
    try {
      return json.readValue(
          s, new com.fasterxml.jackson.core.type.TypeReference<Map<String, String>>() {});
    } catch (Exception e) {
      throw new com.ruoyi.common.exception.ServiceException("模板字段必须是JSON对象");
    }
  }

  public List<Map<String, Object>> templates() {
    return db.queryForList("SELECT * FROM food_message_template ORDER BY event");
  }

  public List<Map<String, Object>> publicTemplates() {
    return configured()
        ? db.queryForList(
            "SELECT event,template_id FROM food_message_template WHERE enabled=1 AND"
                + " template_id<>'' ORDER BY event")
        : List.of();
  }

  public void save(String event, Map<String, Object> body) {
    require(Set.of("ACCEPTED", "READY", "REFUND").contains(event), "无效消息类型");
    String id = text(body, "templateId").trim();
    require(id.matches("[A-Za-z0-9_-]{0,100}"), "模板编号格式不正确");
    var mapping = fields(text(body, "fields"));
    require(!mapping.isEmpty() && mapping.size() <= 5, "模板须配置1至5个字段");
    mapping.forEach(
        (k, v) -> {
          require(
              k != null
                  && v != null
                  && k.matches("(thing|character_string|time|amount|number|phrase)[1-9][0-9]*")
                  && Set.of("store", "status", "time", "amount", "order", "pickup").contains(v),
              "模板字段或取值来源不合法");
          require(!k.startsWith("time") || v.equals("time"), "时间字段须映射time");
          require(!k.startsWith("amount") || v.equals("amount"), "金额字段须映射amount");
          require(!k.startsWith("number") || v.equals("pickup"), "数字字段须映射pickup");
        });
    boolean on = Boolean.TRUE.equals(body.get("enabled"));
    require(!on || !id.isEmpty(), "启用前请填写模板编号");
    require(
        !on
            || db.queryForObject(
                    "SELECT COUNT(*) FROM food_message_template WHERE event<>? AND enabled=1 AND"
                        + " template_id=?",
                    Integer.class,
                    event,
                    id)
                == 0,
        "三类消息须使用不同模板，避免共用一次授权");
    db.update(
        "UPDATE food_message_template SET template_id=?,fields_json=?,enabled=? WHERE event=?",
        id,
        encode(mapping),
        on ? 1 : 0,
        event);
  }

  public void subscribe(long member, String id, Map<String, String> choices) {
    require(
        db.queryForObject(
                "SELECT COUNT(*) FROM food_order WHERE id=? AND member_id=?",
                Integer.class,
                id,
                member)
            == 1,
        "订单不存在");
    require(choices.size() <= 3, "最多订阅三类消息");
    var valid = publicTemplates();
    choices.forEach(
        (event, template) -> {
          require(
              valid.stream()
                  .anyMatch(
                      t -> t.get("event").equals(event) && t.get("template_id").equals(template)),
              "模板配置已变化，请重新订阅");
          db.update(
              "INSERT INTO food_subscription(member_id,order_id,event,template_id) VALUES(?,?,?,?)"
                  + " ON DUPLICATE KEY UPDATE template_id=VALUES(template_id),created_at=NOW()",
              member,
              id,
              event,
              template);
        });
  }

  // Called inside the business transaction: rollback removes both event and notification.
  public void enqueue(String id, String event, String key, String status, long amount) {
    var o =
        db.queryForMap(
            "SELECT o.*,s.name store_name,m.openid FROM food_order o JOIN food_store s ON"
                + " s.id=o.store_id JOIN food_member m ON m.id=o.member_id WHERE o.id=?",
            id);
    if (db.queryForObject(
            "SELECT COUNT(*) FROM food_message WHERE order_id=? AND event=? AND event_key=?",
            Integer.class,
            id,
            event,
            key)
        > 0) return;
    var t = db.queryForMap("SELECT * FROM food_message_template WHERE event=?", event);
    String template = text(t, "template_id");
    boolean consent =
        db.queryForObject(
                "SELECT COUNT(*) FROM food_subscription WHERE member_id=? AND order_id=? AND"
                    + " event=? AND template_id=?",
                Integer.class,
                o.get("member_id"),
                id,
                event,
                template)
            > 0;
    String openid = text(o, "openid");
    String skip =
        !configured()
            ? "微信通知未配置"
            : openid.startsWith("demo:")
                ? "演示账号不发送微信消息"
                : openid.startsWith("web:")
                    ? "网站账号不发送微信消息"
                    : number(t, "enabled") != 1 ? "模板未启用" : !consent ? "用户未订阅本次消息" : "";
    var values =
        Map.of(
            "store",
            text(o, "store_name"),
            "status",
            status,
            "time",
            FoodSelling.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
            "amount",
            String.format(Locale.ROOT, "%.2f", amount / 100.0),
            "order",
            id.substring(Math.max(0, id.length() - 32)),
            "pickup",
            text(o, "pickup_code"));
    Map<String, Object> data = new LinkedHashMap<>();
    fields(text(t, "fields_json"))
        .forEach(
            (field, source) -> {
              String value = values.get(source);
              int max =
                  field.startsWith("thing")
                      ? 20
                      : field.startsWith("phrase")
                          ? 5
                          : field.startsWith("character_string") ? 32 : 100;
              data.put(field, Map.of("value", value.substring(0, Math.min(max, value.length()))));
            });
    var payload =
        Map.of(
            "touser",
            text(o, "openid"),
            "template_id",
            template,
            "page",
            "pages/order/index?id=" + id,
            "miniprogram_state",
            Set.of("developer", "trial", "formal").contains(environment) ? environment : "formal",
            "data",
            data);
    db.update(
        "INSERT INTO"
            + " food_message(order_id,member_id,event,event_key,template_id,payload,status,last_error)"
            + " VALUES(?,?,?,?,?,?,?,?)",
        id,
        o.get("member_id"),
        event,
        key,
        template,
        encode(payload),
        skip.isEmpty() ? "PENDING" : "SKIPPED",
        skip);
    if (skip.isEmpty())
      db.update(
          "DELETE FROM food_subscription WHERE member_id=? AND order_id=? AND event=?",
          o.get("member_id"),
          id,
          event);
  }

  private synchronized String accessToken() {
    if (System.currentTimeMillis() < tokenExpires) return token;
    var result =
        http.get()
            .uri(
                b ->
                    b.path("/cgi-bin/token")
                        .queryParam("grant_type", "client_credential")
                        .queryParam("appid", appid)
                        .queryParam("secret", secret)
                        .build())
            .retrieve()
            .body(Map.class);
    if (result == null || result.get("access_token") == null)
      throw new IllegalStateException("微信凭证获取失败");
    token = result.get("access_token").toString();
    tokenExpires =
        System.currentTimeMillis()
            + Math.max(60, ((Number) result.get("expires_in")).intValue() - 120) * 1000L;
    return token;
  }

  @Scheduled(fixedDelay = 5000, scheduler = "foodMessageScheduler")
  public void dispatch() {
    if (!configured()) return;
    // Unknown results are never automatically resent: WeChat has no send idempotency key.
    db.update(
        "UPDATE food_message SET status='UNKNOWN',last_error='发送进程中断，结果需人工核对' WHERE"
            + " status='SENDING' AND next_attempt<DATE_SUB(NOW(),INTERVAL 2 MINUTE)");
    for (int i = 0; i < 10; i++) {
      Map<String, Object> row =
          tx.execute(
              s -> {
                var rows =
                    db.queryForList(
                        "SELECT * FROM food_message WHERE status='PENDING' AND next_attempt<=NOW()"
                            + " ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
                if (rows.isEmpty()) return null;
                var r = rows.get(0);
                db.update(
                    "UPDATE food_message SET"
                        + " status='SENDING',attempts=attempts+1,next_attempt=NOW() WHERE id=?",
                    r.get("id"));
                return r;
              });
      if (row == null) return;
      String credential;
      try {
        credential = accessToken();
      } catch (Exception e) {
        retry(row, "获取微信凭证失败");
        continue;
      }
      try {
        var response =
            http.post()
                .uri(
                    b ->
                        b.path("/cgi-bin/message/subscribe/send")
                            .queryParam("access_token", credential)
                            .build())
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(text(row, "payload"))
                .retrieve()
                .body(Map.class);
        int code =
            response == null || !(response.get("errcode") instanceof Number)
                ? -999
                : ((Number) response.get("errcode")).intValue();
        if (code == 0)
          db.update(
              "UPDATE food_message SET status='SENT',sent_at=NOW(),last_error='' WHERE id=?",
              row.get("id"));
        else if (Set.of(40001, 40014, 42001, -1).contains(code)) {
          tokenExpires = 0;
          retry(row, "微信返回错误码 " + code);
        } else
          db.update(
              "UPDATE food_message SET status=?,last_error=? WHERE id=?",
              code == -999 ? "UNKNOWN" : "FAILED",
              "微信返回错误码 " + code,
              row.get("id"));
      } catch (Exception e) {
        db.update(
            "UPDATE food_message SET status='UNKNOWN',last_error='网络响应不确定，未自动重发' WHERE id=?",
            row.get("id"));
      }
    }
  }

  private void retry(Map<String, Object> row, String reason) {
    db.update(
        "UPDATE food_message SET status=?,last_error=?,next_attempt=DATE_ADD(NOW(),INTERVAL 60"
            + " SECOND) WHERE id=?",
        number(row, "attempts") >= 2 ? "FAILED" : "PENDING",
        reason,
        row.get("id"));
  }
}
