<template><div class="orders-page"><div class="heading"><div><div class="eyebrow">QINGHE CAMPUS / ORDERS</div><h1>订单工作台</h1><p>从接单到送达，照顾好每一份期待。每15秒自动刷新。</p></div><div><el-button v-if="access.platform||access.stores?.some(s=>allowed(access,s.store_id,'REPLY'))" @click="reviewEditor.open()">顾客评价</el-button><el-button @click="load">刷新订单</el-button></div></div><el-card shadow="never"><el-tabs v-model="status" @tab-change="changeStatus"><el-tab-pane label="全部订单" name=""/><el-tab-pane label="售后申请" name="AFTERSALE"/><el-tab-pane v-for="(label,key) in statuses" :key="key" :label="label" :name="key"/></el-tabs><el-table v-loading="loading" :data="rows"><el-table-column label="订单编号" min-width="200"><template #default="{row}"><el-link type="primary" @click="detail(row)">{{row.id.slice(0,16)}}…</el-link><div class="sub">{{row.created_at}}</div></template></el-table-column><el-table-column label="商家" prop="store_name" min-width="130"/><el-table-column label="配送方式" width="110"><template #default="{row}">{{row.type==='DELIVERY'?'外卖配送':'到店自取'}}</template></el-table-column><el-table-column label="金额" width="100"><template #default="{row}">¥{{money(row.total)}}</template></el-table-column><el-table-column label="预约 / 备餐" min-width="180"><template #default="{row}"><div>{{row.scheduled_at||'尽快制作'}}</div><div class="sub" v-if="row.prepare_at">备餐：{{row.prepare_at}}</div></template></el-table-column><el-table-column label="配送异常" min-width="160"><template #default="{row}"><el-tag v-if="row.delivery_issue" type="danger">{{row.delivery_issue}}</el-tag><el-tag v-else-if="isOverdue(row)" type="warning">超过10分钟无人接单</el-tag><span v-else>—</span></template></el-table-column><el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='COMPLETED'?'success':row.status==='CANCELLED'?'info':'warning'">{{row.refund_status==='REQUESTED'?'退款审核中':statuses[row.status]}}</el-tag></template></el-table-column><el-table-column label="收货信息 / 取餐方式" min-width="200"><template #default="{row}">{{row.type==='PICKUP'?'请顾客出示取餐码':row.address}}</template></el-table-column><el-table-column label="操作" width="165" fixed="right"><template #default="{row}"><el-button v-if="next(row)" link type="primary" :disabled="busy" @click="advance(row)">{{next(row).label}}</el-button><el-button link @click="detail(row)">详情</el-button></template></el-table-column></el-table><el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="load" style="margin-top:24px;justify-content:flex-end"/></el-card>
<el-drawer v-model="visible" title="订单详情" size="520px"><template v-if="order.id"><el-descriptions :column="1" border><el-descriptions-item label="订单编号">{{order.id}}</el-descriptions-item><el-descriptions-item label="商家">{{order.store_name}}</el-descriptions-item><el-descriptions-item label="状态">{{statuses[order.status]}}</el-descriptions-item><el-descriptions-item label="收货信息">{{order.address}}</el-descriptions-item><el-descriptions-item v-if="order.type==='PICKUP'" label="取餐核销">请顾客出示取餐码后核销</el-descriptions-item><el-descriptions-item label="备注">{{order.remark||'无'}}</el-descriptions-item></el-descriptions><el-table :data="order.items" style="margin:25px 0"><el-table-column label="商品" prop="name"/><el-table-column label="规格加料" prop="option_text"/><el-table-column label="净份数" width="95"><template #default="{row}">{{row.quantity-row.refunded_quantity}}<div v-if="row.refunded_quantity" class="sub">原{{row.quantity}} / 已退{{row.refunded_quantity}}</div></template></el-table-column><el-table-column label="单价" width="90"><template #default="{row}">¥{{money(row.price)}}</template></el-table-column></el-table><DeliveryActions :order="order" :platform="platform" @changed="refreshDetail"/><div v-if="order.review"><h3>顾客评价 · {{order.review.rating}} 分</h3><p>{{order.review.content}}</p><p v-if="order.review.reply">商家回复：{{order.review.reply}}</p><el-button v-else @click="reviewEditor.open()">去回复评价</el-button></div><div v-if="order.refunds?.length"><h3>售后记录</h3><div v-for="r in order.refunds" :key="r.id"><p>{{refundLabels[r.status]||r.status}} · ¥{{money(r.amount)}} · {{r.reason}}</p><p>{{r.kind==='ITEMS'?'部分退款':'整单剩余退款'}}</p><p v-for="i in r.items" :key="i.item_id">{{i.name}} ×{{i.quantity}} · ¥{{money(i.amount)}}</p><el-button v-for="e in r.evidenceIds" v-show="allowed(access,order.store_id,'REFUND')" :key="e" @click="viewEvidence(e)">查看图片凭证</el-button><p>{{r.reply}}</p></div></div><div v-if="order.refund_status==='REQUESTED'&&allowed(access,order.store_id,'REFUND')"><el-alert title="按本次申请金额模拟退款。未制作的所退餐品回补库存；其余订单继续履约。" :closable="false"/><el-input v-model="refundReply" type="textarea" maxlength="500" placeholder="填写处理说明（至少2字）" style="margin:16px 0"/><el-button type="success" :disabled="busy" @click="resolveRefund('APPROVE')">同意模拟退款</el-button><el-button type="warning" :disabled="busy" @click="resolveRefund('REJECT')">拒绝并说明原因</el-button></div><el-button v-if="order.status==='PENDING'&&order.refund_status!=='REQUESTED'&&allowed(access,order.store_id,'REFUND')" type="danger" :disabled="busy" @click="rejectOrder">缺货退单并模拟退款</el-button><p>配送费 ¥{{money(order.delivery_fee)}} / 优惠 ¥{{money(order.discount)}}</p><h3>实付 ¥{{money(order.total)}} · 已退 ¥{{money(order.refunded_amount)}}</h3><el-button v-if="next(order)" type="primary" :disabled="busy" @click="advance(order)">{{next(order).label}}</el-button></template></el-drawer><el-dialog :model-value="!!evidenceImage" title="售后图片凭证" @close="evidenceImage=''"><img :src="evidenceImage" style="max-width:100%;max-height:65vh"/></el-dialog><Reviews ref="reviewEditor"/></div></template>
<script setup>
import {ref,watch,onMounted,onBeforeUnmount} from 'vue'
import {allowed} from '../permissions'
import Reviews from '../Reviews.vue'
import DeliveryActions from '../DeliveryActions.vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {foodGet,foodPost,money,statuses} from '@/api/food'

const access=ref({}),evidenceImage=ref(''),reviewEditor=ref(),platform=ref(false)
const refundLabels={REQUESTED:'待审核',APPROVED:'已模拟退款',REJECTED:'已拒绝'},refundReply=ref('')
const route=useRoute(),router=useRouter()
const rows=ref([]),status=ref((statuses[route.query.status]||route.query.status==='AFTERSALE')?route.query.status:'')
const page=ref(1),total=ref(0),loading=ref(false),busy=ref(false),visible=ref(false),order=ref({})
let timer,revision=0,detailRevision=0,evidenceRevision=0,disposed=false

function clearDetail(){detailRevision++;evidenceRevision++;order.value={};refundReply.value='';evidenceImage.value=''}
watch(visible,value=>{if(!value)clearDetail()},{flush:'sync'})
function detailOperation(){
 const id=order.value.id,ticket=detailRevision
 return {id,current:()=>!disposed&&visible.value&&ticket===detailRevision&&order.value.id===id}
}
async function detail(row){
 if(disposed||!row.id)return
 const id=row.id
 clearDetail();visible.value=true
 const ticket=detailRevision
 try{
  const result=await foodGet('/orders/'+id)
  if(!disposed&&visible.value&&ticket===detailRevision)order.value=result.data
 }catch(e){if(!disposed&&ticket===detailRevision)visible.value=false;throw e}
}
async function viewEvidence(id){
 const operation=detailOperation(),ticket=++evidenceRevision
 const result=await foodGet('/evidence/'+id)
 if(operation.current()&&ticket===evidenceRevision)evidenceImage.value=result.data
}
async function refreshDetail(){await detail(order.value);await load()}
async function refreshed(operation,message){
 if(disposed)return
 ElMessage.success(message)
 if(operation.current())await detail({id:operation.id})
 await load()
}
async function resolveRefund(decision){
 if(busy.value||!order.value.id||order.value.refund_status!=='REQUESTED')return
 const operation=detailOperation(),refundId=order.value.refund_id,reply=refundReply.value
 const amount=order.value.refunds?.find(r=>r.id===refundId)?.amount
 busy.value=true
 try{
  try{await ElMessageBox.confirm(decision==='APPROVE'?'确认按本次申请金额模拟退款 ¥'+money(amount)+'？':'确认拒绝这次退款申请？','处理售后')}catch{return}
  if(!operation.current()||order.value.refund_id!==refundId)return
  await foodPost('/orders/'+operation.id+'/refund',{refundId,decision,reply})
  await refreshed(operation,'售后已处理')
 }finally{busy.value=false}
}
async function rejectOrder(){
 if(busy.value||!order.value.id)return
 const operation=detailOperation()
 busy.value=true
 try{
  let value
  try{({value}=await ElMessageBox.prompt('填写缺货或无法接单的原因，确认后全额模拟退款并释放库存。','商家退单',{inputValidator:v=>v?.trim().length>=2&&v.trim().length<=400||'请输入2至400字原因'}))}catch{return}
  if(!operation.current())return
  await foodPost('/orders/'+operation.id+'/reject',{reason:value.trim()})
  await refreshed(operation,'已退单并模拟退款')
 }finally{busy.value=false}
}
function isOverdue(row){return row.status==='WAITING_DELIVERY'&&row.delivery_waiting_at&&Date.now()-new Date(String(row.delivery_waiting_at).replace(' ','T')+'+08:00').getTime()>600000}
function changeStatus(){page.value=1;if((route.query.status||'')!==status.value){router.replace({query:{...route.query,status:status.value||undefined}});load()}}
watch(()=>route.query.status,v=>{if(route.path!='/food/orders')return;const next=(statuses[v]||v==='AFTERSALE')?v:'';if(next===status.value)return;status.value=next;page.value=1;load()})
async function load(){
 if(disposed)return
 const ticket=++revision;loading.value=true
 try{const r=await foodGet('/orders',{page:page.value,status:status.value});if(ticket===revision){rows.value=r.data.rows;total.value=r.data.total}}
 finally{if(ticket===revision)loading.value=false}
}
function next(row){
 if(!allowed(access.value,row.store_id,row.status==='PREPARING'?'COOK':row.status==='READY'?'PICKUP':'ORDER'))return null
 if(row.refund_status==='REQUESTED'||row.delivery_issue)return null
 return {UNPAID:{status:'CANCELLED',label:'取消未支付单'},PENDING:{status:'PREPARING',label:'接单并制作'},PREPARING:{status:row.type==='PICKUP'?'READY':'WAITING_DELIVERY',label:row.type==='PICKUP'?'通知取餐':'呼叫骑手'},READY:{status:'COMPLETED',label:'验码取餐'},DELIVERING:{status:'COMPLETED',label:'确认送达'}}[row.status]
}
async function advance(row){
 if(busy.value)return
 const action=next(row),id=row.id,operation=detailOperation()
 if(!action)return
 busy.value=true
 try{
  let code
  try{
   if(row.status==='READY'){const r=await ElMessageBox.prompt('请输入顾客出示的6位取餐码。','验码取餐',{inputPattern:/^[0-9]{6}$/,inputErrorMessage:'请输入6位数字'});code=r.value}
   else await ElMessageBox.confirm('确认'+action.label+'？','更新订单状态')
  }catch{return}
  if(disposed)return
  await foodPost('/orders/'+id+(code?'/verify-pickup':'/status'),code?{code}:{status:action.status})
  if(disposed)return
  ElMessage.success('状态已更新');await load()
  if(operation.id===id&&operation.current())await detail({id})
 }finally{busy.value=false}
}
onMounted(async()=>{
 access.value=(await foodGet('/scope')).data
 if(disposed)return
 platform.value=access.value.platform;load()
 timer=setInterval(()=>{if(!loading.value)load()},15000)
})
onBeforeUnmount(()=>{disposed=true;revision++;clearDetail();clearInterval(timer)})
</script><style scoped>.orders-page{padding:32px;background:#f6f8f3;min-height:calc(100vh - 85px)}.heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:25px}.eyebrow{font-size:11px;letter-spacing:2px;color:#93a186}h1{font-size:27px;color:#35533c;margin:12px 0}p{font-size:13px;color:#96a08d}.sub{font-size:11px;color:#9aa590;margin-top:8px}.el-card{border-radius:15px;border-color:#e6eddf}</style>
