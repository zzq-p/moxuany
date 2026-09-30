<template>
 <el-dialog v-model="visible" :title="'按日预约库存 · '+product.name" width="660px" @closed="revision++">
  <el-alert title="按用餐日期独立分配库存，不扣即时库存。总配额包含已预订和已售出；菜品与所选规格、加料均需配置。" :closable="false"/>
  <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" @change="load" style="margin:20px 0"/>
  <el-table :data="rows" v-loading="loading"><el-table-column prop="name" label="菜品 / 选项"/><el-table-column prop="used" label="已占用" width="90"/><el-table-column label="当日总配额"><template #default="{row}"><el-input-number v-model="row.capacity" :min="row.used" :max="1000000" :precision="0"/></template></el-table-column><el-table-column label="剩余" width="90"><template #default="{row}">{{row.capacity-row.used}}</template></el-table-column></el-table>
  <template #footer><el-button @click="visible=false">关闭</el-button><el-button type="primary" :disabled="loading||!rows.length" :loading="busy" @click="save">保存当日配额</el-button></template>
 </el-dialog>
</template>
<script setup>
import {ref} from 'vue';import {foodGet,foodPost} from '@/api/food';import {ElMessage} from 'element-plus';
const visible=ref(false),product=ref({}),date=ref(''),rows=ref([]),loading=ref(false),busy=ref(false);let revision=0;
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
async function open(row){product.value=row;date.value=today();visible.value=true;await load()}
async function load(){const ticket=++revision;loading.value=true;rows.value=[];try{const r=await foodGet('/products/'+product.value.id+'/reservation-stock',{date:date.value});if(ticket===revision)rows.value=r.data}finally{if(ticket===revision)loading.value=false}}
async function save(){busy.value=true;try{await foodPost('/products/'+product.value.id+'/reservation-stock?date='+date.value,rows.value);ElMessage.success('当日库存已保存');await load()}catch(e){await load()}finally{busy.value=false}}
defineExpose({open});
</script>
