<template><view class="page"><PageHead title="地图选收货点"/><view class="content"><view class="card"><view class="bold">移动地图，点击实际收货位置</view><view class="subtitle">可以选择宿舍、教学楼或其他收货点，请确认选点与已填写的文字地址一致。</view><view id="shipping-map" class="map"/><view v-if="point" class="subtitle">已选坐标 {{point.latitude.toFixed(6)}}，{{point.longitude.toFixed(6)}}</view><view v-if="error" class="error">{{error}}</view><button class="btn secondary" :loading="locating" @click="locate">定位到我附近</button><button class="btn" style="margin-top:20rpx" :disabled="!point" @click="save">使用这个收货点</button></view></view></view></template>
<script setup>
import {ref,nextTick} from 'vue';import {onLoad,onReady,onUnload} from '@dcloudio/uni-app';import PageHead from '../../components/PageHead.vue';import {acquire} from '../../lib/location';
// #ifdef H5
import 'leaflet/dist/leaflet.css';
// #endif
const point=ref(null),error=ref(''),locating=ref(false);let nonce='',map,L,marker,disposed=false,initial=null;
function select(p){point.value={latitude:Number(p.latitude),longitude:Number(p.longitude)};if(map){if(marker)marker.remove();marker=L.circleMarker([p.latitude,p.longitude],{radius:10,color:'#fff',weight:3,fillColor:'#47785b',fillOpacity:1}).addTo(map)}}
onLoad(o=>{nonce=o.nonce||'';if(o.latitude&&o.longitude){const latitude=Number(o.latitude),longitude=Number(o.longitude);if(Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=85&&Math.abs(longitude)<=180)initial={latitude,longitude}}});
onReady(async()=>{
 // #ifdef H5
 try{L=await import('leaflet');await nextTick();if(disposed)return;map=L.map('shipping-map').setView(initial?[initial.latitude,initial.longitude]:[31,105],initial?16:4);const tiles=L.tileLayer(import.meta.env.VITE_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);tiles.on('tileerror',()=>error.value='地图图片加载失败，请检查网络或配置地图服务后重试');map.on('click',e=>select({latitude:e.latlng.lat,longitude:e.latlng.wrap().lng}));if(initial)select(initial)}catch{error.value='地图暂时无法加载，请返回后重试'}
 // #endif
});
async function locate(){if(locating.value)return;locating.value=true;error.value='';try{const p=await acquire();if(disposed)return;map?.setView([p.latitude,p.longitude],17);select(p)}catch{error.value='未能获取位置，可直接移动地图选择收货点'}finally{locating.value=false}}
function save(){if(!nonce||!point.value)return;uni.setStorageSync('food-map-result',{nonce,...point.value});uni.navigateBack()}onUnload(()=>{disposed=true;map?.remove()});
</script><style scoped>.map{height:55vh;margin:24rpx 0;border-radius:24rpx;background:#e7ecdf;z-index:0}.secondary{background:#e9eee2;color:#35543d}</style>
