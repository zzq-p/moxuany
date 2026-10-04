<template><view class="page"><PageHead title="订单详情"/><view v-if="error" class="content error" @click="load">{{error}} · 点击重试</view><view v-if="order.id" class="content"><view class="status-hero"><view class="status-symbol">{{order.status==='COMPLETED'?'✓':order.status==='CANCELLED'?'○':'◷'}}</view><view class="title">{{order.refund_status==='REQUESTED'?'退款审核中':statuses[order.status]}}</view><view class="subtitle">{{tips[order.status]}}</view><view v-if="order.type==='PICKUP'&&order.status!=='UNPAID'&&order.status!=='CANCELLED'&&order.status!=='REFUNDED'" class="pickup">取餐码 {{order.pickup_code}}</view></view><view class="card"><view class="between"><text class="bold">{{order.store_name}}</text><text class="pill">{{order.type==='DELIVERY'?'外卖配送':'到店自取'}}</text></view><view class="divider"/><view v-for="p in order.items" :key="p.id" class="item"><image :src="p.image" mode="aspectFill"/><view style="flex:1"><view>{{p.name}}</view><view class="tiny muted">{{p.option_text}}</view><text class="small muted">×{{p.quantity}}</text><view v-if="p.refunded_quantity" class="tiny muted">已退 {{p.refunded_quantity}} 份 · 剩余 {{p.quantity-p.refunded_quantity}} 份</view></view><text>¥{{money(p.price*p.quantity)}}</text></view><view class="divider"/><view class="stack small"><view class="between"><text>配送费</text><text>¥{{money(order.delivery_fee)}}</text></view><view class="between"><text>优惠</text><text>−¥{{money(order.discount)}}</text></view><view class="between"><text>实付金额</text><text class="price">¥{{money(order.total)}}</text></view></view></view><view class="card stack small"><view class="bold">订单信息</view><text>收货信息：{{order.address}}</text><text v-if="order.scheduled_at">预约时间：{{String(order.scheduled_at).replace('T',' ')}}</text><text v-if="order.prepare_at">开始备餐：{{String(order.prepare_at).replace('T',' ')}}</text><text>备注：{{order.remark||'无'}}</text><text class="muted">下单时间：{{String(order.created_at).replace('T',' ')}}</text><text class="muted" style="word-break:break-all" @click="copy">订单编号：{{order.id}} ⧉</text></view><view v-if="order.status==='COMPLETED'&&!order.review" class="card"><view class="bold">这一餐，合你心意吗？</view><view class="stars"><text v-for="n in 5" :key="n" @click="rating=n">{{rating>=n?'★':'☆'}}</text></view><textarea v-model="review" class="review" placeholder="分享这次用餐体验（2至500字）" maxlength="500"/><button class="btn light" :disabled="busy" @click="submitReview">提交评价</button></view><view v-if="order.review" class="card stack"><view class="bold">已评价 · {{order.review.rating}} 分</view><text>{{order.review.content}}</text><text v-if="order.review.reply" class="small">商家回复：{{order.review.reply}}</text></view><view v-if="order.delivery_issue" class="card">配送遇到异常，平台正在处理，请耐心等待。</view><AfterSale :order="order" @changed="load"/><OrderExtras :order="order"/><button class="btn outline" @click="go('help/index')">联系平台客服</button></view><view v-if="order.id" class="fixed-action between"><template v-if="order.status==='UNPAID'"><button class="btn outline" :disabled="busy" @click="act('cancel')">取消订单</button><button class="btn" :loading="busy" :disabled="busy" @click="act('pay')">模拟支付 ¥{{money(order.total)}}</button></template><button v-else-if="order.status==='DELIVERING'&&order.refund_status!=='REQUESTED'&&!order.delivery_issue" class="btn" style="width:100%" :disabled="busy" @click="act('complete')">{{order.type==='PICKUP'?'确认已取餐':'确认已送达'}}</button><view v-else-if="order.status==='READY'" class="small">请向商家出示取餐码，由商家验码取餐</view><button v-else class="btn light" style="width:100%" @click="go('store/index?id='+order.store_id)">再去这家逛逛</button></view></view></template>
<script setup>
import {ref,watch} from 'vue'
import AfterSale from '../../components/AfterSale.vue'
import OrderExtras from '../../components/OrderExtras.vue'
import {onLoad,onShow,onHide,onUnload} from '@dcloudio/uni-app'
import PageHead from '../../components/PageHead.vue'
import {state,money,statuses,go,toast,confirm} from '../../lib/api'
import {captureSession} from '../../lib/session'
import {intents} from '../../lib/recovery'
const id=ref(''),order=ref({}),error=ref(''),busy=ref(false),review=ref(''),rating=ref(5)
let timer,visible=false,loadRevision=0,pageRevision=0
const tips={UNPAID:'15分钟内完成模拟支付，美味即将启程',PENDING:'订单已送达商家，请稍等片刻',PREPARING:'厨师正在用心准备你的美味',DELIVERING:'你的美味正在路上',READY:'餐品已备好，凭取餐码到店领取',COMPLETED:'谢谢你的喜欢，期待下一餐再见',CANCELLED:'订单已取消，库存与优惠券已退回',REFUNDED:'已完成模拟退款，不涉及真实资金',WAITING_DELIVERY:'餐品已备好，等待骑手接配送单'}
function reset(){loadRevision++;pageRevision++;clearTimeout(timer);order.value={};review.value='';rating.value=5;busy.value=false;error.value=state.token?'登录状态已变化，请重试':'请先前往“我的”登录'}
watch(()=>[state.token,state.authRevision],reset,{flush:'sync'})
async function load(){
 if(!id.value)return
 if(!state.token||state.signedOut){reset();return}
 const ticket=++loadRevision,session=captureSession();clearTimeout(timer)
 try{
  const result=await session.request('/orders/'+id.value)
  if(ticket!==loadRevision||!session.current())return
  order.value=result
  if(intents.read()?.orderId===result.id&&intents.read()?.memberId===state.memberId)intents.settled(state.memberId,result.id)
  error.value=''
 }catch(e){
  if(ticket===loadRevision){order.value={};error.value=e.message}
 }finally{
  if(ticket===loadRevision&&session.current()&&visible&&(!['COMPLETED','CANCELLED','REFUNDED'].includes(order.value.status)||order.value.refund_status==='REQUESTED'))timer=setTimeout(load,10000)
 }
}
async function act(action){
 if(busy.value||!order.value.id)return
 const session=captureSession(),revision=pageRevision,orderId=id.value
 busy.value=true
 try{
  if(!await confirm(action==='pay'?'进行模拟支付？不会扣除真实资金。':action==='cancel'?'确认取消这笔订单？':'确认已收到餐品？'))return
  session.assertCurrent();if(revision!==pageRevision)return
  await session.request('/orders/'+orderId+'/'+action,'POST')
  if(revision!==pageRevision)return
  await load();if(session.current()&&revision===pageRevision)toast('操作成功')
 }catch(e){if(session.current()&&revision===pageRevision)error.value=e.message}
 finally{if(revision===pageRevision)busy.value=false}
}
async function submitReview(){
 if(busy.value||!order.value.id)return
 const session=captureSession(),revision=pageRevision
 busy.value=true
 try{
  await session.request('/orders/'+id.value+'/review','POST',{rating:rating.value,content:review.value})
  if(revision!==pageRevision)return
  await load();if(session.current()&&revision===pageRevision)toast('谢谢你的评价')
 }catch(e){if(session.current()&&revision===pageRevision)error.value=e.message}
 finally{if(revision===pageRevision)busy.value=false}
}
function copy(){if(order.value.id)uni.setClipboardData({data:order.value.id})}
onLoad(o=>{id.value=o.id})
onShow(()=>{visible=true;load()})
function stop(){visible=false;loadRevision++;pageRevision++;busy.value=false;clearTimeout(timer)}
onHide(stop);onUnload(stop)
</script>
<style scoped>.status-hero{text-align:center;padding:22rpx 10rpx 40rpx}.status-symbol{font-size:65rpx;color:#73916b;margin-bottom:14rpx}.pickup{font-size:37rpx;letter-spacing:5rpx;margin-top:20rpx;color:#386649}.item{display:flex;align-items:center;gap:20rpx;margin-bottom:23rpx;font-size:25rpx}.item image{width:105rpx;height:105rpx;border-radius:15rpx}.stars{font-size:49rpx;color:#c6a553;letter-spacing:15rpx;margin:20rpx 0}.review{font-size:26rpx;height:150rpx;width:100%}</style>
