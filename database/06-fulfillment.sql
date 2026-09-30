CREATE TABLE IF NOT EXISTS food_feature_migration (name VARCHAR(100) PRIMARY KEY,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_reservation_stock (
 product_id BIGINT NOT NULL, option_id BIGINT NOT NULL DEFAULT 0, stock_date DATE NOT NULL,
 capacity INT NOT NULL DEFAULT 0, used INT NOT NULL DEFAULT 0, version BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(product_id,stock_date,option_id), CHECK(capacity>=used), CHECK(used>=0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_reservation_slot (
 store_id BIGINT NOT NULL, scheduled_at DATETIME NOT NULL, used INT NOT NULL DEFAULT 0,
 PRIMARY KEY(store_id,scheduled_at), CHECK(used>=0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS food_order_event (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id VARCHAR(40) NOT NULL,
 action VARCHAR(40) NOT NULL, actor_id BIGINT NOT NULL, actor_name VARCHAR(100) NOT NULL,
 note VARCHAR(500) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_event_order(order_id,id)
) ENGINE=InnoDB;
