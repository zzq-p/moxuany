<template><view>
 <view v-if="order.queue" class="card stack"><view class="bold">{{order.queue.waitingForSchedule?'预约待制作':'出餐排队'}}</view><text>前面还有 {{order.queue.ahead}} 单 · 预计约 {{order.queue.minutes}} 分钟出餐</text><text class="small muted">预计出餐：{{String(order.queue.estimatedReadyAt).replace('T',' ').slice(0,16)}}，实际以厨房进度为准</text><text v-if="order.queue.overdue" class="small">已超过原预计时间 {{order.queue.overdueMinutes}} 分钟，商家工作台已突出提醒</text></view>
 <view v-if="templates.length" class="card stack"><view class="bold">订单进度通知</view><text class="small muted">自愿订阅接单、出餐和退款结果，每次授权仅用于相应的一次通知。</text><button class="btn light" :disabled="subscribing" @click="subscribe">{{subscribed?'再次选择订阅通知':'订阅微信通知'}}</button></view>
 <view class="card"><button class="btn light" :disabled="busy" @click="again">再来一单</button><text class="tiny muted">按当前价格、规格和库存重新确认，不会直接下单</text></view>
</view></template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';import {request,toast} from '../lib/api';import {reorder} from '../lib/reorder';import {captureSession} from '../lib/session';const props=defineProps({order:Object});const busy=ref(false),templates=ref([]),subscribing=ref(false),subscribed=ref(false)
let active=true;onBeforeUnmount(()=>{active=false})
onMounted(async()=>{
 // #ifdef MP-WEIXIN
 try{templates.value=await request('/subscriptions','GET',null,true)}catch{}
 // #endif
})
async function again(){if(busy.value)return;busy.value=true;try{await reorder(props.order.id)}catch(e){toast(e.message)}finally{busy.value=false}}
function subscribe(){
 // #ifdef MP-WEIXIN
 if(subscribing.value)return;subscribing.value=true;const session=captureSession(),id=props.order.id
 uni.requestSubscribeMessage({tmplIds:[...new Set(templates.value.map(t=>t.template_id))].slice(0,3),success:async result=>{try{session.assertCurrent();if(!active||id!==props.order.id)return;const choices={};for(const t of templates.value)if(result[t.template_id]==='accept')choices[t.event]=t.template_id;await session.request('/orders/'+id+'/subscriptions','POST',choices);if(!active||id!==props.order.id)return;subscribed.value=Object.keys(choices).length>0;toast(subscribed.value?'已记录订阅选择':'未订阅，也可在订单页查看进度')}catch(e){if(active&&session.current())toast(e.message)}finally{subscribing.value=false}},fail:()=>{subscribing.value=false;if(active&&session.current())toast('未开启订阅，可稍后重试')}})
 // #endif
}
</script>
