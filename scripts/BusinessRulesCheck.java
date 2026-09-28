import com.ruoyi.food.FoodBusinessRules;
import java.time.LocalTime;
import java.util.*;
public class BusinessRulesCheck {
    static void check(boolean pass){if(!pass)throw new AssertionError();}
    public static void main(String[] args){
        Map<String,Object> store=new HashMap<>(Map.of("active",1,"open_time","09:00","close_time","17:00"));
        check(!FoodBusinessRules.isOpen(store,LocalTime.of(8,59)));
        check(FoodBusinessRules.isOpen(store,LocalTime.of(9,0)));
        check(FoodBusinessRules.isOpen(store,LocalTime.of(16,59)));
        check(!FoodBusinessRules.isOpen(store,LocalTime.of(17,0)));
        store.put("open_time","22:00");store.put("close_time","06:00");
        for(String t:List.of("22:00","23:59","00:00","05:59"))check(FoodBusinessRules.isOpen(store,LocalTime.parse(t)));
        for(String t:List.of("21:59","06:00","12:00"))check(!FoodBusinessRules.isOpen(store,LocalTime.parse(t)));
        store.put("open_time","");store.put("close_time","");check(FoodBusinessRules.isOpen(store,LocalTime.NOON));
        store.put("active",0);check(!FoodBusinessRules.isOpen(store,LocalTime.NOON));
        check(Math.abs(FoodBusinessRules.distance(0,0,0.001,0)-111.195)<0.01);
        System.out.println("PASS Java opening inclusive / closing exclusive, midnight span, all-day/manual closure and WGS84 distance");
    }
}
