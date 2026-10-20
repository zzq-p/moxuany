package com.ruoyi.food;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class FoodMessageScheduling {
  @Bean(name = "foodMessageScheduler")
  public ThreadPoolTaskScheduler messageScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(1);
    scheduler.setThreadNamePrefix("food-message-");
    return scheduler;
  }

  // Keep order expiry on a separate scheduler so slow WeChat requests cannot delay stock release.
  @Bean(name = "taskScheduler")
  public ThreadPoolTaskScheduler businessScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(1);
    scheduler.setThreadNamePrefix("food-business-");
    return scheduler;
  }
}
