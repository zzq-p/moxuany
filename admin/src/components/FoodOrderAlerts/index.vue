<template><div v-if="allowed" class="order-reminder" role="status">
 <div><strong>接单提醒</strong><span v-if="failed" class="warn">连接失败，正在重试</span><span v-else>{{pending}} 单待接单<span v-if="overdue" class="warn"> · {{overdue}} 单已等候超过5分钟</span></span></div>
 <span v-if="deliveryOverdue||deliveryIssues" class="warn">配送：{{deliveryOverdue}} 单超时未接 · {{deliveryIssues}} 单异常待处理</span><div class="actions"><el-button v-if="deliveryOverdue||deliveryIssues" size="small" @click="router.push('/food/orders?status='+(deliveryIssues?'DELIVERING':'WAITING_DELIVERY'))">处理配送</el-button><el-button size="small" :type="sound?'success':'default'" @click="toggleSound">{{sound?'提示音已开启':'开启提示音'}}</el-button><el-button size="small" type="primary" @click="router.push('/food/orders?status=PENDING')">去接单</el-button></div>
</div></template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue'
import {useRouter} from 'vue-router'
import {ElNotification,ElMessage} from 'element-plus'
import useUserStore from '@/store/modules/user'
import request from '@/utils/request'
const user=useUserStore(),router=useRouter(),pending=ref(0),overdue=ref(0),deliveryOverdue=ref(0),deliveryIssues=ref(0),failed=ref(false),sound=ref(false)
const allowed=computed(()=>!!user.token&&(user.permissions.includes('*:*:*')||user.permissions.includes('food:manage')))
let timer,revision=0,seen=new Set(),audio,lastBeep=0,notification
function beep(){if(!sound.value||!audio||audio.state!=='running')return;const tone=audio.createOscillator(),gain=audio.createGain();tone.connect(gain);gain.connect(audio.destination);tone.frequency.value=880;gain.gain.setValueAtTime(0.12,audio.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime+0.45);tone.start();tone.stop(audio.currentTime+0.45);lastBeep=Date.now()}
async function toggleSound(){if(sound.value){sound.value=false;return}try{audio??=new(window.AudioContext||window.webkitAudioContext)();await audio.resume();sound.value=true;beep()}catch{ElMessage.warning('浏览器暂不能播放提示音，请检查声音设置')}}
async function poll(ticket){
 try{const {data}=await request({url:'/food/admin/order-alerts',method:'get',silent:true});if(ticket!==revision)return;failed.value=false;pending.value=Number(data.pending);overdue.value=Number(data.overdue);const previousDelivery=deliveryOverdue.value+deliveryIssues.value;deliveryOverdue.value=Number(data.deliveryOverdue||0);deliveryIssues.value=Number(data.deliveryIssues||0);if(deliveryOverdue.value+deliveryIssues.value>previousDelivery){ElNotification({title:"配送需要处理",message:"存在超时未接或异常配送订单，请前往订单工作台处理。",type:"warning"});beep()}
  const fresh=data.rows.filter(row=>!seen.has(row.id));for(const row of data.rows)seen.add(row.id);
  if(seen.size>1000)seen=new Set(data.rows.map(row=>row.id));
  if(fresh.length){notification?.close();notification=ElNotification({title:'有订单等待接单',message:'当前有 '+pending.value+' 单待处理，请及时制作。',type:'warning',duration:8000,onClick:()=>router.push('/food/orders?status=PENDING')});beep()}
  else if(overdue.value&&Date.now()-lastBeep>=60000)beep()
 }catch{if(ticket===revision)failed.value=true}
 finally{if(ticket===revision&&allowed.value)timer=setTimeout(()=>poll(ticket),failed.value?30000:10000)}
}
function stop(){revision++;clearTimeout(timer);seen.clear();pending.value=0;overdue.value=0;deliveryOverdue.value=0;deliveryIssues.value=0;failed.value=false;notification?.close();sound.value=false;if(audio){audio.close().catch(()=>{});audio=null}}
watch(()=>[allowed.value,user.id,user.token],()=>{stop();if(allowed.value)poll(revision)},{immediate:true})
onBeforeUnmount(stop)
</script>
<style scoped>.order-reminder{padding:10px 24px;background:#f0f6ed;border-bottom:1px solid #dbe6d5;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;color:#49623f}.order-reminder strong{margin-right:14px}.warn{color:#c37528;margin-left:10px}.actions{display:flex;flex-shrink:0;gap:8px}@media(max-width:600px){.order-reminder{flex-wrap:wrap;padding:10px 14px}}</style>
