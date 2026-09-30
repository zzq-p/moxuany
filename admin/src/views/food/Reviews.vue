<template><el-dialog v-model="visible" title="顾客评价" width="820px"><el-table :data="rows" v-loading="loading"><el-table-column prop="store_name" label="商家" width="130"/><el-table-column prop="nickname" label="顾客" width="100"/><el-table-column prop="rating" label="评分" width="65"/><el-table-column prop="content" label="评价"/><el-table-column label="商家回复"><template #default="{row}"><span v-if="row.reply">{{row.reply}}</span><el-button v-else link type="primary" :disabled="busy" @click="reply(row)">回复评价</el-button></template></el-table-column></el-table><el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="total,prev,pager,next" @current-change="load"/></el-dialog></template>
<script setup>
import {ref} from 'vue';import {foodGet,foodPost} from '@/api/food';import {ElMessageBox,ElMessage} from 'element-plus';
const visible=ref(false),rows=ref([]),page=ref(1),total=ref(0),loading=ref(false),busy=ref(false);let revision=0;
async function load(){const ticket=++revision;loading.value=true;try{const r=await foodGet('/reviews',{page:page.value});if(ticket===revision){rows.value=r.data.rows;total.value=r.data.total}}finally{if(ticket===revision)loading.value=false}}
async function open(){visible.value=true;page.value=1;await load()}
async function reply(row){let value;try{({value}=await ElMessageBox.prompt('回复将公开展示，提交后不可修改。','回复评价',{inputType:'textarea',inputValidator:v=>v?.trim().length>=2&&v.trim().length<=500||'请输入2至500字'}))}catch{return}busy.value=true;try{await foodPost('/orders/'+row.order_id+'/review-reply',{reply:value.trim()});ElMessage.success('回复已发布');await load()}finally{busy.value=false}}
defineExpose({open});
</script>
