package com.ruoyi.food;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
public final class FoodReservations {
 public static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");
 private FoodReservations(){}
 private static long number(Map<String,Object> row,String key){return ((Number)row.get(key)).longValue();}
 private static void require(boolean value,String message){if(!value)throw new com.ruoyi.common.exception.ServiceException(message);}
 public static LocalDateTime parse(Map<String,Object> store,String value){
  if(value==null||value.isBlank())return null;
  require(number(store,"reservation_enabled")==1,"商家未开放预约");LocalDateTime slot;
  try{slot=LocalDateTime.parse(value);}catch(Exception e){throw new com.ruoyi.common.exception.ServiceException("预约时间格式不正确");}
  require(valid(store,slot,LocalDateTime.now(ZONE)),"预约时段已失效或不在营业时间，请重新选择");return slot;
 }
 public static boolean valid(Map<String,Object> s,LocalDateTime slot,LocalDateTime now){
  int lead=(int)number(s,"lead_minutes");if(slot.getSecond()!=0||slot.getNano()!=0||slot.getMinute()%30!=0||slot.isBefore(now.plusMinutes(lead))||!slot.toLocalDate().isBefore(now.toLocalDate().plusDays(number(s,"reservation_days"))))return false;
  // The whole preparation interval must be open, including across midnight or meal breaks.
  for(int minute=0;minute<=lead;minute++)if(!FoodBusinessRules.isOpen(s,slot.minusMinutes(minute).toLocalTime()))return false;return true;
 }
 public static List<Map<String,String>> slots(Map<String,Object> store){
  if(number(store,"reservation_enabled")!=1)return List.of();var now=LocalDateTime.now(ZONE);List<Map<String,String>> result=new ArrayList<>();
  for(var t=now.toLocalDate().atStartOfDay();t.toLocalDate().isBefore(now.toLocalDate().plusDays(number(store,"reservation_days")));t=t.plusMinutes(30))if(valid(store,t,now))result.add(Map.of("value",t.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")),"label",t.format(DateTimeFormatter.ofPattern("MM月dd日 HH:mm"))));return result;
 }
}
