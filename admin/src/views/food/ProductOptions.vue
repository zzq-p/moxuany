<template><el-dialog v-model="visible" :title="'规格与加料 · '+product.name" width="900px" append-to-body><el-alert title="规格价格为菜品完整价格，加料额外累加；每份同时扣菜品总库存及所选选项库存。停用请关闭上架开关。" :closable="false"/><el-table v-loading="loading" :data="rows" style="margin-top:20px"><el-table-column label="类型" width="120"><template #default="{row}"><el-select v-model="row.kind" :disabled="!!row.id"><el-option label="规格" value="SPEC"/><el-option label="加料" value="ADDON"/></el-select></template></el-table-column><el-table-column label="名称"><template #default="{row}"><el-input v-model="row.name" maxlength="60"/></template></el-table-column><el-table-column label="价格（元）" width="180"><template #default="{row}"><el-input-number :model-value="row.price/100" @update:model-value="row.price=Math.round(Number($event||0)*100)" :precision="2" :min="row.kind==='SPEC'?0.01:0" :max="10000"/></template></el-table-column><el-table-column label="库存" width="180"><template #default="{row}"><el-input-number v-model="row.stock" :min="0" :max="1000000"/></template></el-table-column><el-table-column label="上架" width="80"><template #default="{row}"><el-switch v-model="row.active" :active-value="1" :inactive-value="0"/></template></el-table-column><el-table-column label="移除" width="70"><template #default="{row,$index}"><el-button v-if="!row.id" link type="danger" @click="rows.splice($index,1)">移除</el-button></template></el-table-column></el-table><el-button style="margin-top:20px" :disabled="!ready||loading||saving||rows.length>=30" @click="rows.push({kind:'SPEC',name:'',price:product.price,stock:100,active:1})">新增规格或加料</el-button><template #footer><el-button @click="visible=false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!ready||loading" @click="save">保存配置</el-button></template></el-dialog></template>
<script setup>
import {ref,watch,onBeforeUnmount} from 'vue'
import {ElMessage} from 'element-plus'
import {foodGet,foodPost} from '@/api/food'

const visible=ref(false),product=ref({}),rows=ref([]),loading=ref(false),ready=ref(false),saving=ref(false)
let revision=0,disposed=false
function invalidate(){revision++;rows.value=[];loading.value=false;ready.value=false;saving.value=false}
watch(visible,value=>{if(!value)invalidate()},{flush:'sync'})
onBeforeUnmount(()=>{disposed=true;invalidate()})
function current(ticket,id){return !disposed&&visible.value&&ticket===revision&&product.value.id===id}
async function open(p){
 if(disposed)return
 invalidate()
 const ticket=revision,id=p.id
 product.value=p;visible.value=true;loading.value=true
 try{
  const result=await foodGet('/products/'+id+'/options')
  if(current(ticket,id)){rows.value=result.data;ready.value=true}
 }catch{if(current(ticket,id))visible.value=false}
 finally{if(current(ticket,id))loading.value=false}
}
async function save(){
 if(disposed||!visible.value||!ready.value||loading.value||saving.value)return
 const ticket=revision,id=product.value.id,body=rows.value.map(row=>({...row}))
 saving.value=true
 try{
  await foodPost('/products/'+id+'/options',body)
  if(!current(ticket,id))return
  ElMessage.success('规格与加料已保存');visible.value=false
 }catch{}finally{if(current(ticket,id))saving.value=false}
}
defineExpose({open})
</script>
