package com.ruoyi.food;
import com.ruoyi.common.core.domain.entity.SysUser;
import com.ruoyi.common.utils.SecurityUtils;
import com.ruoyi.system.service.ISysUserService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import static com.ruoyi.food.FoodSupport.*;

@Service
public class FoodMerchantAccounts {
 private final JdbcTemplate db;private final ISysUserService users;private final FoodScope scope;
 public FoodMerchantAccounts(JdbcTemplate db,ISysUserService users,FoodScope scope){this.db=db;this.users=users;this.scope=scope;}
 @Transactional public void create(long store,String username,String password){
   scope.platformOnly();scope.store(store);
   require(username!=null&&username.matches("[A-Za-z][A-Za-z0-9_]{3,29}"),"账号须为4至30位字母、数字或下划线，以字母开头");
   require(password!=null&&password.length()>=10&&password.length()<=50,"密码须为10至50位");
   SysUser user=new SysUser();user.setUserName(username);user.setNickName(db.queryForObject("SELECT name FROM food_store WHERE id=?",String.class,store));
   require(users.checkUserNameUnique(user),"账号已存在");user.setPassword(SecurityUtils.encryptPassword(password));user.setStatus("0");user.setRoleIds(new Long[]{100L});user.setCreateBy(SecurityUtils.getUsername());
   users.insertUser(user);db.update("INSERT INTO food_store_user(store_id,user_id) VALUES(?,?)",store,user.getUserId());
 }
}
