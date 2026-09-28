package com.ruoyi.food;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.jdbc.core.JdbcTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Configuration
@EnableScheduling
public class FoodExpiry {
    private static final Logger log=LoggerFactory.getLogger(FoodExpiry.class);
    private final JdbcTemplate db; private final FoodOrders orders;
    public FoodExpiry(JdbcTemplate db,FoodOrders orders){this.db=db;this.orders=orders;}
    @Scheduled(fixedDelay=30000)
    public void expire(){
        for(String id:db.queryForList("SELECT id FROM food_order WHERE status='UNPAID' AND expires_at<NOW() ORDER BY expires_at LIMIT 100",String.class)) {
            try {orders.transition(id,null,"CANCELLED");} catch(Exception e){log.warn("Expiry skipped order {}: {}",id,e.getMessage());}
        }
    }
}
