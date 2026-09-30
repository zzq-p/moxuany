CREATE TABLE IF NOT EXISTS food_favorite (
 member_id BIGINT NOT NULL,kind VARCHAR(10) NOT NULL,target_id BIGINT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(member_id,kind,target_id)
) ENGINE=InnoDB;
INSERT INTO sys_role(role_name,role_key,role_sort,data_scope,status,create_by,create_time)
 SELECT '商家接单员','food_clerk',5,'5','0','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_role WHERE role_key='food_clerk');
INSERT INTO sys_role(role_name,role_key,role_sort,data_scope,status,create_by,create_time)
 SELECT '商家后厨','food_kitchen',6,'5','0','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_role WHERE role_key='food_kitchen');
INSERT INTO sys_menu(menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time)
 SELECT '出餐排队',2100,9,'kitchen','food/kitchen/index',1,0,'C','0','0','food:kitchen','time','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE perms='food:kitchen');
INSERT INTO sys_menu(menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time)
 SELECT '员工与记录',2100,10,'staff','food/staff/index',1,0,'C','0','0','food:staff','peoples','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE perms='food:staff');
INSERT INTO sys_menu(menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time)
 SELECT '微信通知',2100,11,'messages','food/messages/index',1,0,'C','0','0','food:messages','message','admin',NOW() WHERE NOT EXISTS(SELECT 1 FROM sys_menu WHERE perms='food:messages');
INSERT IGNORE INTO sys_role_menu(role_id,menu_id) SELECT r.role_id,m.menu_id FROM sys_role r JOIN sys_menu m ON m.menu_id IN (2100,2104) OR m.perms='food:kitchen' WHERE r.role_key IN ('food_clerk','food_kitchen');
INSERT IGNORE INTO sys_role_menu(role_id,menu_id) SELECT r.role_id,m.menu_id FROM sys_role r JOIN sys_menu m ON m.perms IN ('food:kitchen','food:staff') WHERE r.role_key='food_merchant';
CREATE TABLE IF NOT EXISTS food_refund_item (
 refund_id VARCHAR(40) NOT NULL,item_id BIGINT NOT NULL,quantity INT NOT NULL,amount INT NOT NULL,
 PRIMARY KEY(refund_id,item_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_evidence (
 id VARCHAR(40) PRIMARY KEY,member_id BIGINT NOT NULL,order_id VARCHAR(40) NOT NULL,
 file_path VARCHAR(500) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_evidence_owner(member_id,order_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_refund_evidence (
 refund_id VARCHAR(40) NOT NULL,evidence_id VARCHAR(40) NOT NULL,PRIMARY KEY(refund_id,evidence_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_staff_audit (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,store_id BIGINT NOT NULL,actor_id BIGINT NOT NULL,
 actor_name VARCHAR(64) NOT NULL,action VARCHAR(40) NOT NULL,target VARCHAR(80) NOT NULL,
 note VARCHAR(500) NOT NULL DEFAULT '',created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_staff_audit(store_id,id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_message_template (
 event VARCHAR(20) PRIMARY KEY,template_id VARCHAR(100) NOT NULL DEFAULT '',
 fields_json TEXT NOT NULL,enabled TINYINT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT IGNORE INTO food_message_template(event,fields_json) VALUES
 ('ACCEPTED','{"thing1":"store","thing2":"status","time3":"time"}'),
 ('READY','{"thing1":"store","thing2":"status","time3":"time"}'),
 ('REFUND','{"thing1":"store","thing2":"status","amount3":"amount"}');
CREATE TABLE IF NOT EXISTS food_subscription (
 member_id BIGINT NOT NULL,order_id VARCHAR(40) NOT NULL,event VARCHAR(20) NOT NULL,
 template_id VARCHAR(100) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(member_id,order_id,event)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_message (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,order_id VARCHAR(40) NOT NULL,member_id BIGINT NOT NULL,
 event VARCHAR(20) NOT NULL,event_key VARCHAR(60) NOT NULL,template_id VARCHAR(100) NOT NULL DEFAULT '',
 payload TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'PENDING',attempts INT NOT NULL DEFAULT 0,
 next_attempt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,last_error VARCHAR(200) NOT NULL DEFAULT '',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at DATETIME NULL,
 UNIQUE KEY uk_message_event(order_id,event,event_key),INDEX idx_message_send(status,next_attempt,id)
) ENGINE=InnoDB;
