CREATE TABLE IF NOT EXISTS food_rider_user(user_id BIGINT PRIMARY KEY,name VARCHAR(60) NOT NULL,phone VARCHAR(20) NOT NULL,active TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
INSERT INTO sys_role(role_name,role_key,role_sort,data_scope,status,create_by,create_time)
 SELECT '校园骑手','food_rider',4,'5','0','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_role WHERE role_key='food_rider');
INSERT INTO sys_menu(menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time)
 SELECT '配送工作台',2100,6,'delivery','food/delivery/index',1,0,'C','0','0','food:delivery','job','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE perms='food:delivery');
INSERT INTO sys_menu(menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time)
 SELECT '经营报表',2100,7,'reports','food/reports/index',1,0,'C','0','0','food:reports','chart','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE perms='food:reports');
INSERT INTO sys_menu(menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time)
 SELECT '骑手管理',2100,8,'riders','food/riders/index',1,0,'C','0','0','food:riders','user','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE perms='food:riders');
INSERT IGNORE INTO sys_role_menu(role_id,menu_id) SELECT r.role_id,m.menu_id FROM sys_role r JOIN sys_menu m ON m.menu_id=2100 OR m.perms='food:delivery' WHERE r.role_key='food_rider';
INSERT IGNORE INTO sys_role_menu(role_id,menu_id) SELECT r.role_id,m.menu_id FROM sys_role r JOIN sys_menu m ON m.perms='food:reports' WHERE r.role_key='food_merchant';
