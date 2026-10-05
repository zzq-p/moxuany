<template><el-dialog v-model="visible" title="分时售卖与临时售罄" width="530px"><el-form label-width="110px"><el-form-item label="菜品">{{product.name}}</el-form-item><el-form-item label="售卖时段"><el-input v-model="form.periods" placeholder="07:00-10:00,11:00-14:00"/><div class="hint">北京时间，最多4段，留空全天；预约按所选用餐时间判断。</div></el-form-item><el-form-item label="暂停售卖"><el-switch v-model="form.soldOut"/><div class="hint">暂停期间不可新下单，不影响已下单餐品。</div></el-form-item><el-form-item v-if="form.soldOut" label="自动恢复"><el-date-picker v-model="form.until" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="留空表示手动恢复"/></el-form-item></el-form><template #footer><el-button @click="visible=false">取消</el-button><el-button type="primary" :loading="busy" @click="save">保存</el-button></template></el-dialog></template>
<script setup>
import {ref} from 'vue';import {foodPost} from '@/api/food';import {ElMessage} from 'element-plus';const emit=defineEmits(['changed']),visible=ref(false),busy=ref(false),product=ref({}),form=ref({});
function open(row){
 product.value=row
 const soldOut=!!row.sold_out&&(!row.sold_out_until||Date.parse(String(row.sold_out_until).replace(' ','T')+'+08:00')>Date.now())
 form.value={periods:row.sale_periods||'',soldOut,until:soldOut?(row.sold_out_until||''):'',version:row.version}
 visible.value=true
}
async function save(){busy.value=true;try{await foodPost('/products/'+product.value.id+'/selling',{...form.value,until:form.value.soldOut?form.value.until:''});visible.value=false;ElMessage.success('售卖设置已保存');emit('changed')}finally{busy.value=false}}
defineExpose({open})
</script><style scoped>.hint{font-size:12px;color:#879280;line-height:1.7}</style>
