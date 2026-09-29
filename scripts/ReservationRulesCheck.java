import com.ruoyi.food.FoodReservations;
import com.ruoyi.food.FoodBusinessRules;
import java.time.*;
import java.util.*;
public class ReservationRulesCheck {
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args){
  var s=new HashMap<String,Object>(Map.of("active",1,"reservation_enabled",1,"reservation_days",3,"lead_minutes",30,"business_periods","07:00-10:00,11:00-14:00,17:00-21:00","open_time","","close_time",""));var now=LocalDateTime.parse("2026-09-29T06:00:00");
  check(!FoodReservations.valid(s,now.withHour(11),now));check(FoodReservations.valid(s,now.withHour(11).withMinute(30),now));check(!FoodReservations.valid(s,now.withHour(14),now));
  s.put("lead_minutes",180);check(!FoodReservations.valid(s,now.withHour(12),now));
  s.put("business_periods","22:00-06:00");s.put("lead_minutes",60);check(FoodReservations.valid(s,now.plusDays(1).withHour(0),now));check(!FoodReservations.valid(s,now.plusDays(3).withHour(0),now));
  boolean rejected=false;try{FoodBusinessRules.validatePeriods("07:00-10:00,");}catch(RuntimeException e){rejected=true;}check(rejected);
  System.out.println("PASS split meal boundaries, preparation cannot cross closure, overnight slots and reservation horizon");
 }
}
