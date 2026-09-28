SET NAMES utf8mb4;
CREATE TABLE food_store_user (store_id BIGINT NOT NULL,user_id BIGINT NOT NULL UNIQUE,PRIMARY KEY(store_id,user_id)) ENGINE=InnoDB;
CREATE TABLE food_member (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, openid VARCHAR(100) NOT NULL UNIQUE,
 nickname VARCHAR(60) NOT NULL DEFAULT '校园食客', points INT NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE food_store (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) NOT NULL, category VARCHAR(40) NOT NULL,
 zone VARCHAR(40) NOT NULL, description VARCHAR(500) NOT NULL DEFAULT '', image VARCHAR(500) NOT NULL,
 rating DECIMAL(2,1) NOT NULL DEFAULT 4.9, sales INT NOT NULL DEFAULT 0, minutes INT NOT NULL DEFAULT 30,
 latitude DECIMAL(9,6) NULL, longitude DECIMAL(10,6) NULL,
 open_time VARCHAR(5) NOT NULL DEFAULT '',close_time VARCHAR(5) NOT NULL DEFAULT '',delivery_radius INT NOT NULL DEFAULT 0,
 distance INT NOT NULL DEFAULT 200, delivery_fee INT NOT NULL DEFAULT 200, minimum INT NOT NULL DEFAULT 1300,
 notice VARCHAR(500) NOT NULL DEFAULT '', phone VARCHAR(30) NOT NULL DEFAULT '', active TINYINT NOT NULL DEFAULT 1,
 INDEX idx_store_category_active(category,active)
) ENGINE=InnoDB;
CREATE TABLE food_product (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, store_id BIGINT NOT NULL, name VARCHAR(100) NOT NULL,
 category VARCHAR(50) NOT NULL, description VARCHAR(500) NOT NULL DEFAULT '', image VARCHAR(500) NOT NULL,
 price INT NOT NULL, stock INT NOT NULL DEFAULT 100, sales INT NOT NULL DEFAULT 0,
 active TINYINT NOT NULL DEFAULT 1, version BIGINT NOT NULL DEFAULT 0, INDEX idx_product_store(store_id,active),
 INDEX idx_product_category(store_id,active,category,id),
 CONSTRAINT fk_product_store FOREIGN KEY(store_id) REFERENCES food_store(id), CHECK(price>0), CHECK(stock>=0)
) ENGINE=InnoDB;
CREATE TABLE food_address (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, member_id BIGINT NOT NULL, contact VARCHAR(50) NOT NULL,
 phone VARCHAR(20) NOT NULL, detail VARCHAR(250) NOT NULL,
 latitude DECIMAL(9,6) NULL,longitude DECIMAL(10,6) NULL, INDEX idx_address_member(member_id)
) ENGINE=InnoDB;
CREATE TABLE food_coupon (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, member_id BIGINT NOT NULL, title VARCHAR(60) NOT NULL,
 amount INT NOT NULL, minimum INT NOT NULL, expires_at DATETIME NOT NULL, used_order VARCHAR(40),
 INDEX idx_coupon_member(member_id,used_order)
) ENGINE=InnoDB;
CREATE TABLE food_order (
 id VARCHAR(40) PRIMARY KEY, member_id BIGINT NOT NULL, store_id BIGINT NOT NULL, request_key VARCHAR(80) NOT NULL,
 request_hash VARCHAR(64) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'UNPAID', type VARCHAR(20) NOT NULL,
 subtotal INT NOT NULL DEFAULT 0, delivery_fee INT NOT NULL DEFAULT 0, discount INT NOT NULL DEFAULT 0,
 total INT NOT NULL DEFAULT 0, coupon_id BIGINT, address VARCHAR(350) NOT NULL DEFAULT '',
 remark VARCHAR(200) NOT NULL DEFAULT '', pickup_code VARCHAR(10) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL,
 paid_at DATETIME, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uk_order_request(member_id,request_key), INDEX idx_order_member(member_id,created_at),
 INDEX idx_order_member_filter(member_id,type,status,created_at,id),
 INDEX idx_order_alert(status,paid_at,id),
 INDEX idx_order_expiry(status,expires_at), INDEX idx_order_store(store_id,status,created_at)
) ENGINE=InnoDB;
CREATE TABLE food_order_item (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id VARCHAR(40) NOT NULL, product_id BIGINT NOT NULL,
 name VARCHAR(100) NOT NULL, image VARCHAR(500) NOT NULL, price INT NOT NULL, quantity INT NOT NULL,
 INDEX idx_item_order(order_id), CONSTRAINT fk_item_order FOREIGN KEY(order_id) REFERENCES food_order(id)
) ENGINE=InnoDB;
CREATE TABLE food_checkin (member_id BIGINT NOT NULL, day DATE NOT NULL, PRIMARY KEY(member_id,day)) ENGINE=InnoDB;
CREATE TABLE food_feedback (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, member_id BIGINT NOT NULL, content VARCHAR(1000) NOT NULL,
 reply VARCHAR(1000), created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE food_review (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id VARCHAR(40) NOT NULL UNIQUE, member_id BIGINT NOT NULL,
 store_id BIGINT NOT NULL, rating INT NOT NULL, content VARCHAR(500) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_review_store(store_id,created_at)
) ENGINE=InnoDB;
INSERT INTO food_store(id,name,category,zone,description,image,rating,sales,minutes,distance,delivery_fee,minimum,notice,phone) VALUES
(1,'卤味研究所','家常菜','一食堂','一口入魂的招牌卤味，每天现卤，认真做饭。','/static/food/rice.jpg',4.9,3027,25,180,200,1300,'午饭好好吃，下午才有力气。每日现卤，售完即止。','4000000000'),
(2,'青禾轻食','轻食沙拉','商业街','把新鲜和好心情一起装进碗里。','/static/food/salad.jpg',4.8,1862,20,350,100,1800,'新鲜蔬菜每日配送，酱汁单独包装。','4000000000'),
(3,'麦香汉堡社','炸鸡汉堡','二食堂','现炸酥脆，快乐加倍。','/static/food/burger.jpg',4.9,2480,30,420,200,1500,'所有汉堡现点现做，请耐心等待。','4000000000'),
(4,'岛屿咖啡','甜品饮品','商业街','给忙碌的一天，留一点松弛。','/static/food/coffee.jpg',4.9,986,18,260,200,1200,'咖啡默认少糖，可在订单备注调整。','4000000000'),
(5,'面面俱到','粉面小吃','一食堂','热气腾腾的面，踏踏实实的满足。','/static/food/noodles.jpg',4.7,1670,22,120,100,1200,'面汤分装，收到后趁热享用。','4000000000'),
(6,'早安食堂','营养早餐','二食堂','从一份热乎早餐开始。','/static/food/breakfast.jpg',4.8,2140,15,210,100,800,'早餐供应至上午十点半。','4000000000');
INSERT INTO food_product(store_id,name,category,description,image,price,stock,sales) VALUES
(1,'招牌卤鸭腿饭','招牌必点','秘制卤鸭腿 + 时蔬 + 香软米饭','/static/food/rice.jpg',1480,200,4068),
(1,'香菇滑鸡饭','招牌必点','鲜嫩鸡肉，浓香菌菇，营养又下饭','/static/food/chicken.jpg',1680,200,2344),
(1,'双拼卤肉饭','人气套餐','两种卤味，一次满足，附赠时蔬','/static/food/rice.jpg',1980,100,1820),
(1,'田园时蔬饭','清爽素食','当季鲜蔬 + 香菇 + 米饭','/static/food/salad.jpg',1280,80,368),
(1,'冰爽柠檬茶','饮料小食','新鲜柠檬，清爽解腻','/static/food/tea.jpg',600,200,670),
(2,'牛油果鸡胸能量碗','能量碗','牛油果 + 鸡胸肉 + 田园鲜蔬','/static/food/salad.jpg',2280,100,890),
(2,'缤纷田园沙拉','清爽素食','多种当季蔬菜，低负担好滋味','/static/food/salad.jpg',1880,100,530),
(3,'双层芝士牛肉堡','人气汉堡','双层牛肉饼 + 浓郁芝士','/static/food/burger.jpg',1980,100,1280),
(3,'香辣鸡腿堡套餐','超值套餐','鸡腿堡 + 薯条 + 柠檬茶','/static/food/burger.jpg',2580,100,760),
(4,'燕麦拿铁','咖啡','醇厚咖啡与燕麦奶的温柔碰撞','/static/food/coffee.jpg',1580,100,586),
(4,'手打柠檬茶','果茶','现切柠檬，清香茉莉茶底','/static/food/tea.jpg',1280,100,730),
(5,'招牌牛肉面','热汤面','慢炖牛肉，浓郁高汤','/static/food/noodles.jpg',1680,100,980),
(6,'元气早餐组合','早餐套餐','煎蛋 + 烤面包 + 热牛奶','/static/food/breakfast.jpg',980,100,1200);
INSERT INTO sys_menu(menu_id,menu_name,parent_id,order_num,path,component,is_frame,is_cache,menu_type,visible,status,perms,icon,create_by,create_time) VALUES
(2100,'校园点餐',0,0,'food',NULL,1,0,'M','0','0','','shopping','admin',NOW()),
(2101,'经营概览',2100,1,'overview','food/overview/index',1,0,'C','0','0','food:manage','dashboard','admin',NOW()),
(2102,'商家管理',2100,2,'stores','food/stores/index',1,0,'C','0','0','food:manage','shop','admin',NOW()),
(2103,'商品管理',2100,3,'products','food/products/index',1,0,'C','0','0','food:manage','shopping','admin',NOW()),
(2104,'订单管理',2100,4,'orders','food/orders/index',1,0,'C','0','0','food:manage','list','admin',NOW()),
(2105,'用户与反馈',2100,5,'members','food/members/index',1,0,'C','0','0','food:manage','user','admin',NOW());
INSERT INTO sys_role(role_id,role_name,role_key,role_sort,data_scope,status,create_by,create_time) VALUES(100,'商家管理员','food_merchant',3,'5','0','admin',NOW());
INSERT INTO sys_role_menu(role_id,menu_id) VALUES(100,2100),(100,2101),(100,2102),(100,2103),(100,2104);
