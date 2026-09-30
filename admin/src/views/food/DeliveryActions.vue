<template><div>
 <el-alert v-if="order.delivery_issue" :title="'配送异常：'+order.delivery_issue" type="error" :closable="false"/>
 <p v-if="order.delivery_waiting_at">开始等待骑手：{{order.delivery_waiting_at}}</p>
 <p v-if="order.rider_id">配送骑手编号：{{order.rider_id}}</p>
 <template v-if="platform&&['WAITING_DELIVERY','DELIVERING'].includes(order.status)&&order.refund_status!=='REQUESTED'">
  <el-button :disabled="busy" @click="open">{{order.rider_id?'转派骑手':'平台派单'}}</el-button>
  <el-button v-if="order.delivery_issue" :disabled="busy" @click="resolve">异常已处理，继续配送</el-button>
 </template>
 <el-dialog v-model="visible" title="平台派单 / 转派" width="480px" append-to-body>
  <el-select v-model="riderId" placeholder="选择骑手" style="width:100%"><el-option v-for="r in riders" :key="r.user_id" :value="r.user_id" :disabled="!r.active||r.user_id===order.rider_id||r.active_orders>=r.max_active" :label="r.name+'（配送中 '+r.active_orders+'/'+r.max_active+'）'"/></el-select>
  <el-input v-model="reason" type="textarea" maxlength="400" placeholder="填写派单原因，转派前请确认餐品交接安排" style="margin-top:16px"/>
  <template #footer><el-button type="primary" :loading="busy" :disabled="!riderId||reason.trim().length<2" @click="assign">确认派单</el-button></template>
 </el-dialog>
 <h3 v-if="order.events?.length">履约记录</h3><div v-for="(e,i) in order.events" :key="i" class="event">{{e.created_at}} · {{e.actor_name}}<br/>{{e.note}}</div>
</div></template>
<script setup>
import {ref} from 'vue';import request from '@/utils/request';import {ElMessageBox,ElMessage} from 'element-plus';
const props=defineProps({order:{type:Object,required:true},platform:Boolean}),emit=defineEmits(['changed']),visible=ref(false),busy=ref(false),riders=ref([]),riderId=ref(),reason=ref('');let version;
async function open(){riders.value=(await request({url:'/food/delivery/riders'})).data;riderId.value=undefined;reason.value='';version=props.order.delivery_version;visible.value=true}
async function assign(){busy.value=true;try{await request({url:'/food/delivery/orders/'+props.order.id+'/reassign',method:'post',data:{riderId:riderId.value,version,reason:reason.value.trim()}});visible.value=false;ElMessage.success('派单成功');emit('changed')}catch(e){visible.value=false;emit('changed')}finally{busy.value=false}}
async function resolve(){let value;const currentVersion=props.order.delivery_version;try{({value}=await ElMessageBox.prompt('填写处理结果，原骑手将继续配送。','处理配送异常',{inputValidator:v=>v?.trim().length>=2&&v.trim().length<=400||'请输入2至400字'}))}catch{return}busy.value=true;try{await request({url:'/food/delivery/orders/'+props.order.id+'/resolve',method:'post',data:{version:currentVersion,reason:value.trim()}});ElMessage.success('异常已处理');emit('changed')}finally{busy.value=false}}
</script>
<style scoped>.event{margin:12px 0;padding:12px;background:#f4f7f2;line-height:1.7;font-size:13px}</style>
