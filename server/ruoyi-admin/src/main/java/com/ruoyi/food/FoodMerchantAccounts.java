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
   require(username!=null&&username.matches("[A-Za-z][A-Za-z0-9_]{3,19}"),"账号须为4至20位字母、数字或下划线，以字母开头");
   require(password!=null&&password.length()>=10&&password.length()<=20,"密码须为10至20位");
   SysUser user=new SysUser();user.setUserName(username);user.setNickName(db.queryForObject("SELECT name FROM food_store WHERE id=?",String.class,store));
   require(users.checkUserNameUnique(user),"账号已存在");user.setPassword(SecurityUtils.encryptPassword(password));user.setStatus("0");user.setRoleIds(new Long[]{100L});user.setCreateBy(SecurityUtils.getUsername());
   users.insertUser(user);db.update("INSERT INTO food_store_user(store_id,user_id) VALUES(?,?)",store,user.getUserId());
 }
 @Transactional public void createRider(String username,String password,String name,String phone){
  scope.platformOnly();require(username!=null&&username.matches("[A-Za-z][A-Za-z0-9_]{3,19}"),"账号格式不正确");require(password!=null&&password.length()>=10&&password.length()<=20,"密码须为10至20位");require(name!=null&&!name.isBlank()&&name.length()<=60&&phone!=null&&phone.matches("1[3-9][0-9]{9}"),"请填写骑手姓名和手机号");
  SysUser u=new SysUser();u.setUserName(username);u.setNickName(name);require(users.checkUserNameUnique(u),"账号已存在");u.setPassword(SecurityUtils.encryptPassword(password));u.setStatus("0");u.setRoleIds(new Long[]{db.queryForObject("SELECT role_id FROM sys_role WHERE role_key='food_rider'",Long.class)});u.setCreateBy(SecurityUtils.getUsername());users.insertUser(u);db.update("INSERT INTO food_rider_user(user_id,name,phone) VALUES(?,?,?)",u.getUserId(),name,phone);
 }
 @Transactional public void createStaff(long store,String username,String password,String name,String role){
  scope.permit(store,"STAFF");require(java.util.Set.of("MANAGER","CLERK","KITCHEN").contains(java.util.Objects.toString(role,"")),"请选择有效岗位");if(role.equals("MANAGER"))scope.platformOnly();
  require(username!=null&&username.matches("[A-Za-z][A-Za-z0-9_]{3,19}"),"账号须为4至20位字母、数字或下划线");require(password!=null&&password.length()>=10&&password.length()<=20,"密码须为10至20位");require(name!=null&&!name.isBlank()&&name.length()<=30,"请填写员工姓名");
  SysUser u=new SysUser();u.setUserName(username);u.setNickName(name);require(users.checkUserNameUnique(u),"账号已存在");u.setPassword(SecurityUtils.encryptPassword(password));u.setStatus("0");u.setRoleIds(new Long[]{roleId(role)});u.setCreateBy(SecurityUtils.getUsername());users.insertUser(u);db.update("INSERT INTO food_store_user(store_id,user_id,staff_role) VALUES(?,?,?)",store,u.getUserId(),role);scope.audit(store,"STAFF_CREATE",u.getUserId().toString(),"新增岗位 "+role);
 }
 private Long roleId(String role){return db.queryForObject("SELECT role_id FROM sys_role WHERE role_key=?",Long.class,switch(role){case "MANAGER"->"food_merchant";case "CLERK"->"food_clerk";default->"food_kitchen";});}
 @Transactional public void updateStaff(long store,long user,String role,int active){
  scope.permit(store,"STAFF");require(java.util.Set.of("MANAGER","CLERK","KITCHEN").contains(role)&&(active==0||active==1),"岗位或状态无效");require(user!=SecurityUtils.getUserId(),"不能修改自己的岗位或停用自己");
  db.queryForMap("SELECT id FROM food_store WHERE id=? FOR UPDATE",store);var old=db.queryForList("SELECT * FROM food_store_user WHERE store_id=? AND user_id=? FOR UPDATE",store,user);require(!old.isEmpty(),"员工不存在");if(role.equals("MANAGER")||old.get(0).get("staff_role").equals("MANAGER"))scope.platformOnly();
  if(old.get(0).get("staff_role").equals("MANAGER")&&(active==0||!role.equals("MANAGER")))require(db.queryForObject("SELECT COUNT(*) FROM food_store_user WHERE store_id=? AND active=1 AND staff_role='MANAGER' AND user_id<>?",Integer.class,store,user)>0,"至少保留一位在职店长");
  db.update("UPDATE food_store_user SET staff_role=?,active=? WHERE store_id=? AND user_id=?",role,active,store,user);db.update("DELETE FROM sys_user_role WHERE user_id=?",user);db.update("INSERT INTO sys_user_role(user_id,role_id) VALUES(?,?)",user,roleId(role));scope.audit(store,"STAFF_UPDATE",Long.toString(user),role+" / "+(active==1?"启用":"停用"));
 }
}
