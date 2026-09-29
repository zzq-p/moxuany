package com.ruoyi.food;

import java.time.*;
import java.util.Map;
import java.util.Objects;
import com.ruoyi.common.exception.ServiceException;

public final class FoodBusinessRules {
    private FoodBusinessRules() {}
    private static String text(Map<String,Object> row,String key){return Objects.toString(row.get(key),"");}
    private static long number(Map<String,Object> row,String key){return ((Number)row.get(key)).longValue();}
    private static void require(boolean condition,String message){if(!condition)throw new ServiceException(message);}
    public static void validateHours(String open,String close) {
        require(open.isEmpty()==close.isEmpty(),"营业开始与结束时间须一起填写，留空表示全天");
        if(open.isEmpty())return;
        require(open.matches("([01][0-9]|2[0-3]):[0-5][0-9]")&&close.matches("([01][0-9]|2[0-3]):[0-5][0-9]"),"营业时间须为HH:mm格式");
        require(!open.equals(close),"开始和结束时间不能相同；全天营业请清空时间");
    }
    public static boolean isOpen(Map<String,Object> store,LocalTime now) {
        if(number(store,"active")!=1)return false;
        String periods=text(store,"business_periods");
        if(!periods.isBlank()){for(String period:periods.split(",")){String[] p=period.split("-");if(within(p[0],p[1],now))return true;}return false;}
        String open=text(store,"open_time"),close=text(store,"close_time");
        if(open.isEmpty()&&close.isEmpty())return true;
        return within(open,close,now);
    }
    public static void validatePeriods(String periods){
        if(periods.isBlank())return;String[] entries=periods.split(",",-1);require(entries.length<=4,"最多设置4段营业时间");
        for(String p:entries){String[] pair=p.split("-",-1);require(pair.length==2,"分段时间格式如07:00-10:00,11:00-14:00");validateHours(pair[0],pair[1]);require(!pair[0].isEmpty(),"时段不能为空");}
    }
    private static boolean within(String open,String close,LocalTime now){
        LocalTime start=LocalTime.parse(open),end=LocalTime.parse(close);
        return start.isBefore(end)?!now.isBefore(start)&&now.isBefore(end):!now.isBefore(start)||now.isBefore(end);
    }
    public static Map<String,Object> decorate(Map<String,Object> store) {
        store.put("open_now",isOpen(store,LocalTime.now(ZoneId.of("Asia/Shanghai"))));
        String open=text(store,"open_time"),close=text(store,"close_time");
        store.put("opening_text",open.isEmpty()?"全天营业":open+"–"+(open.compareTo(close)>0?"次日 ":"")+close);
        if(!text(store,"business_periods").isBlank())store.put("opening_text",text(store,"business_periods").replace(","," / "));
        return store;
    }
    public static void requireOpen(Map<String,Object> store) {
        require(isOpen(store,LocalTime.now(ZoneId.of("Asia/Shanghai"))),"商家当前不在营业时间，请稍后再来");
    }
    public static double distance(double lat1,double lng1,double lat2,double lng2) {
        double h=Math.pow(Math.sin(Math.toRadians(lat2-lat1)/2),2)+Math.cos(Math.toRadians(lat1))*Math.cos(Math.toRadians(lat2))*Math.pow(Math.sin(Math.toRadians(lng2-lng1)/2),2);
        return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
    }
    public static void requireDelivery(Map<String,Object> store,Map<String,Object> address) {
        long radius=store.get("delivery_radius")==null?0:number(store,"delivery_radius");
        if(radius==0)return;
        require(store.get("latitude")!=null&&store.get("longitude")!=null,"商家尚未完善配送坐标");
        require(address.get("latitude")!=null&&address.get("longitude")!=null,"请编辑收货地址并标记收货点，或选择到店自取");
        double d=distance(((Number)store.get("latitude")).doubleValue(),((Number)store.get("longitude")).doubleValue(),((Number)address.get("latitude")).doubleValue(),((Number)address.get("longitude")).doubleValue());
        require(d<=radius,"收货地址超出商家配送范围，可选择到店自取");
    }
}
