package com.ruoyi.food;

import com.google.code.kaptcha.Producer;
import com.ruoyi.common.config.RuoYiConfig;
import com.ruoyi.common.constant.CacheConstants;
import com.ruoyi.common.core.redis.RedisCache;
import com.ruoyi.common.exception.ServiceException;
import com.ruoyi.common.utils.SecurityUtils;
import com.ruoyi.common.utils.sign.Base64;
import com.ruoyi.common.utils.uuid.IdUtils;
import com.ruoyi.system.service.ISysConfigService;
import jakarta.annotation.Resource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.FastByteArrayOutputStream;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.util.*;
import java.util.concurrent.TimeUnit;

import static com.ruoyi.food.FoodSupport.*;

/**
 * Username/password accounts for the public H5 site. Registration is gated by a
 * single-use invite code and the same image captcha used by the admin console.
 */
@Service
public class FoodWebAuth {
    @Value("${food.web-login-enabled:true}") private boolean enabled;
    private final JdbcTemplate db;
    private final FoodSupport support;
    private final FoodMemberService members;
    private final RedisCache redisCache;
    private final ISysConfigService configService;
    @Resource(name = "captchaProducer") private Producer captchaProducer;
    @Resource(name = "captchaProducerMath") private Producer captchaProducerMath;

    // A fixed hash keeps "unknown account" and "wrong password" similarly expensive.
    private static final String DUMMY_HASH = SecurityUtils.encryptPassword("food-web-dummy-password");

    public FoodWebAuth(JdbcTemplate db, FoodSupport support, FoodMemberService members,
                       RedisCache redisCache, ISysConfigService configService) {
        this.db = db;
        this.support = support;
        this.members = members;
        this.redisCache = redisCache;
        this.configService = configService;
    }

    public boolean enabled() { return enabled; }
    public boolean captchaEnabled() { return configService.selectCaptchaEnabled(); }

    public Map<String, Object> captcha() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", captchaEnabled());
        if (!captchaEnabled()) return result;

        String uuid = IdUtils.simpleUUID();
        String key = CacheConstants.CAPTCHA_CODE_KEY + uuid;
        String capStr, code;
        BufferedImage image;
        String type = RuoYiConfig.getCaptchaType();
        if ("math".equals(type)) {
            String capText = captchaProducerMath.createText();
            capStr = capText.substring(0, capText.lastIndexOf("@"));
            code = capText.substring(capText.lastIndexOf("@") + 1);
            image = captchaProducerMath.createImage(capStr);
        } else {
            capStr = code = captchaProducer.createText();
            image = captchaProducer.createImage(capStr);
        }
        try {
            FastByteArrayOutputStream os = new FastByteArrayOutputStream();
            ImageIO.write(image, "jpg", os);
            redisCache.setCacheObject(key, code, 2, TimeUnit.MINUTES);
            result.put("uuid", uuid);
            result.put("img", Base64.encode(os.toByteArray()));
            return result;
        } catch (Exception e) {
            throw new ServiceException("验证码生成失败，请重试");
        }
    }

    @Transactional
    public Map<String, Object> register(Map<String, String> input) {
        require(enabled, "网站登录未启用");
        verifyCaptcha(input);

        String account = str(input, "account").trim().toLowerCase(Locale.ROOT);
        String password = str(input, "password");
        String nickname = str(input, "nickname").trim();
        String invite = str(input, "inviteCode").trim().toUpperCase(Locale.ROOT);

        require(account.matches("[a-z0-9_]{4,32}"), "用户名须为4至32位字母、数字或下划线");
        require(password.length() >= 8 && password.length() <= 64, "密码长度须为8至64位");
        require(!password.matches(".*\\s.*"), "密码不能包含空格");
        require(password.matches(".*[A-Za-z].*") && password.matches(".*[0-9].*"), "密码须同时包含字母和数字");
        if (nickname.isEmpty()) nickname = "校园食客";
        require(nickname.length() <= 20, "昵称最多20字");
        require(invite.matches("[A-Z0-9]{6,24}"), "邀请码格式不正确");
        require(db.queryForObject("SELECT COUNT(*) FROM food_member WHERE account=?", Integer.class, account) == 0, "用户名已被使用");

        String openid = "web:" + UUID.randomUUID().toString().replace("-", "");
        try {
            db.update("INSERT INTO food_member(openid,account,password_hash,nickname) VALUES(?,?,?,?)",
                    openid, account, SecurityUtils.encryptPassword(password), nickname);
        } catch (DuplicateKeyException e) {
            throw new ServiceException("用户名已被使用");
        }
        long id = db.queryForObject("SELECT id FROM food_member WHERE account=?", Long.class, account);

        // Claim the invite only after the member row exists, so a rejected
        // registration never burns a code. A failed claim rolls the member back.
        int claimed = db.update("UPDATE food_invite_code SET used_by=?,used_at=NOW() "
                + "WHERE code=? AND used_by IS NULL AND (expires_at IS NULL OR expires_at>NOW())", id, invite);
        require(claimed == 1, "邀请码无效或已被使用");

        members.welcome(id);
        return sessionPayload(id, account, nickname);
    }

    public Map<String, Object> login(Map<String, String> input) {
        require(enabled, "网站登录未启用");
        verifyCaptcha(input);

        String account = str(input, "account").trim().toLowerCase(Locale.ROOT);
        String password = str(input, "password");
        require(account.matches("[a-z0-9_]{4,32}") && !password.isEmpty() && password.length() <= 72, "用户名或密码错误");

        List<Map<String, Object>> rows = db.queryForList(
                "SELECT id,password_hash,nickname FROM food_member WHERE account=? AND password_hash IS NOT NULL", account);
        String hash = rows.isEmpty() ? DUMMY_HASH : text(rows.get(0), "password_hash");
        boolean ok = SecurityUtils.matchesPassword(password, hash) && !rows.isEmpty();
        require(ok, "用户名或密码错误");

        return sessionPayload(number(rows.get(0), "id"), account, text(rows.get(0), "nickname"));
    }

    private Map<String, Object> sessionPayload(long id, String account, String nickname) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("token", support.session(id));
        result.put("memberId", id);
        result.put("account", account);
        result.put("nickname", nickname);
        return result;
    }

    private void verifyCaptcha(Map<String, String> input) {
        if (!captchaEnabled()) return;
        String uuid = str(input, "captchaUuid").trim();
        String code = str(input, "captchaCode").trim();
        require(!uuid.isEmpty() && !code.isEmpty(), "请输入验证码");
        String key = CacheConstants.CAPTCHA_CODE_KEY + uuid;
        Object expected = redisCache.getCacheObject(key);
        redisCache.deleteObject(key);
        require(expected != null, "验证码已过期，请刷新后重试");
        require(Objects.toString(expected, "").equalsIgnoreCase(code), "验证码错误");
    }

    private static String str(Map<String, String> input, String key) {
        return Objects.toString(input.get(key), "");
    }
}
