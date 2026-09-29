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
 @Transactional public void createRider(String username,String password,String name,String phone){
  scope.platformOnly();require(username!=null&&username.matches("[A-Za-z][A-Za-z0-9_]{3,29}"),"账号格式不正确");require(password!=null&&password.length()>=10&&password.length()<=50,"密码须为10至50位");require(name!=null&&!name.isBlank()&&name.length()<=60&&phone!=null&&phone.matches("1[3-9][0-9]{9}"),"请填写骑手姓名和手机号");
  SysUser u=new SysUser();u.setUserName(username);u.setNickName(name);require(users.checkUserNameUnique(u),"账号已存在");u.setPassword(SecurityUtils.encryptPassword(password));u.setStatus("0");u.setRoleIds(new Long[]{db.queryForObject("SELECT role_id FROM sys_role WHERE role_key='food_rider'",Long.class)});u.setCreateBy(SecurityUtils.getUsername());users.insertUser(u);db.update("INSERT INTO food_rider_user(user_id,name,phone) VALUES(?,?,?)",u.getUserId(),name,phone);
 }
}
