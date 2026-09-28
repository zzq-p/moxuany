<template><view class="page"><PageHead title="选择你的位置"/><view class="content">
  <view class="card"><view class="title">发现身边的好味道</view><view class="subtitle">定位用于显示所在城市和估算商家距离。开启城市解析服务后，坐标会发送至地图服务商用于查询城市。</view>
    <button class="btn locate-button" :loading="location.busy" :disabled="location.busy" @click="locationActions.locate">{{location.busy?'正在定位…':'⌖ 使用当前位置'}}</button>
    <view v-if="location.point" class="located">✓ {{location.label}}</view><view v-if="location.hint" class="subtitle">{{location.hint}}</view><view v-if="location.error" class="error">{{location.error}}</view>
    <button v-if="location.point" class="btn locate-button" @click="back">使用此位置</button>
  </view>
  <view class="title region-title">也可以手动选择区域</view><view class="small muted">以下区域来自当前营业商家，手动选择不代表 GPS 定位。</view>
  <view v-if="error" class="error" @click="load">{{error}} · 点击重试</view><view class="card region-list"><view @click="select('全部')">全部区域 <text>›</text></view><view v-for="zone in zones" :key="zone" @click="select(zone)">{{zone}} <text>›</text></view></view>
</view></view></template>
<script setup>
import {ref,computed} from 'vue';import {onShow} from '@dcloudio/uni-app';import PageHead from '../../components/PageHead.vue';import {request} from '../../lib/api';import {location,locationActions} from '../../lib/location';
const zones=ref([]),error=ref('');
function back(){uni.navigateBack({fail:()=>uni.reLaunch({url:'/pages/home/index'})})}function select(zone){locationActions.manual(zone);back()}
async function load(){error.value='';try{zones.value=await request('/catalog/zones','GET',null,true)}catch(e){error.value=e.message}}
onShow(()=>{locationActions.expire();load()});
</script>
<style scoped>.locate-button{margin-top:30rpx}.located{margin-top:25rpx;color:#386847;font-weight:700}.region-title{margin:40rpx 0 15rpx}.region-list{margin-top:24rpx}.region-list view{padding:28rpx 0;border-bottom:1rpx solid #edf0e7;display:flex;justify-content:space-between}.region-list view:last-child{border-bottom:0}.region-list text{color:#8b9c80}</style>
