package com.ruoyi.food;

import com.fasterxml.jackson.databind.JsonNode;
import com.ruoyi.common.annotation.Anonymous;
import com.ruoyi.common.core.domain.AjaxResult;
import com.ruoyi.common.exception.ServiceException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import java.util.Map;
import static com.ruoyi.food.FoodSupport.require;

@Anonymous
@RestController
@RequestMapping("/food/app/location")
public class FoodLocationController {
    private final FoodSupport support;
    private final RestClient client;
    @Value("${food.baidu-map-ak:}") private String mapKey;

    public FoodLocationController(FoodSupport support) {
        this.support=support;
        var factory=new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);factory.setReadTimeout(3000);
        client=RestClient.builder().baseUrl("https://api.map.baidu.com").requestFactory(factory).build();
    }
    static Double coordinate(Object value,int bound) {
        if(value==null || value instanceof String s && s.isBlank())return null;
        double n;
        try{n=Double.parseDouble(value.toString());}catch(Exception e){throw new ServiceException("经纬度格式不正确");}
        require(Double.isFinite(n)&&Math.abs(n)<=bound,"经纬度超出允许范围");return n;
    }
    // POST avoids precise locations in URL/access logs. No persistence or coordinate cache.
    @PostMapping("/reverse") public AjaxResult reverse(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        Double latitude=coordinate(body.get("latitude"),90),longitude=coordinate(body.get("longitude"),180);
        require(latitude!=null&&longitude!=null,"请提供完整经纬度");
        if(mapKey.isBlank())return fallback("NOT_CONFIGURED");
        support.limit("geocode:"+request.getRemoteAddr(),20,60);
        support.limit("geocode:global",200,60);
        try {
            JsonNode response=client.get().uri(b->b.path("/reverse_geocoding/v3/")
                .queryParam("ak",mapKey).queryParam("output","json").queryParam("coordtype","wgs84ll")
                .queryParam("extensions_poi",0).queryParam("location",latitude+","+longitude).build()).retrieve().body(JsonNode.class);
            if(response!=null&&response.path("status").asInt(-1)==0) {
                JsonNode address=response.path("result").path("addressComponent");
                String city=address.path("city").asText("");
                if(city.isBlank())city=address.path("province").asText("");
                String district=address.path("district").asText("");
                if(!city.isBlank())return AjaxResult.success(Map.of("resolved",true,"label",city+(district.isBlank()?"":" · "+district)));
            }
        } catch(Exception ignored) { /* Keep coordinates and keys out of exception logs. */ }
        return fallback("UNAVAILABLE");
    }
    private AjaxResult fallback(String reason){return AjaxResult.success(Map.of("resolved",false,"label","当前位置","reason",reason));}
}
