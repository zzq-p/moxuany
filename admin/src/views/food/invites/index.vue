<template>
  <div class="app-container">
    <h2 style="color:#456747">邀请码</h2>
    <p style="color:#929d87">网站注册必须使用邀请码，每个邀请码只能注册一个账号。邀请码仅平台总后台可管理。</p>
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">生成邀请码</el-button>
      <el-select v-model="status" style="width:150px" @change="search">
        <el-option label="全部" value=""/>
        <el-option label="未使用" value="UNUSED"/>
        <el-option label="已使用" value="USED"/>
        <el-option label="已过期" value="EXPIRED"/>
      </el-select>
      <span class="summary">可用 {{summary.unused||0}} · 已用 {{summary.used||0}} · 已过期 {{summary.expired||0}}</span>
    </div>
    <el-table :data="rows" v-loading="loading">
      <el-table-column label="邀请码" width="230">
        <template #default="{row}"><span class="code">{{row.code}}</span><el-button link type="primary" @click="copy(row.code)">复制</el-button></template>
      </el-table-column>
      <el-table-column label="备注" prop="note" min-width="140"/>
      <el-table-column label="状态" width="100">
        <template #default="{row}"><el-tag :type="tagType(row)">{{statusLabel(row)}}</el-tag></template>
      </el-table-column>
      <el-table-column label="使用者" min-width="140">
        <template #default="{row}">{{row.used_account||row.used_nickname||'—'}}</template>
      </el-table-column>
      <el-table-column label="创建时间" prop="created_at" width="170"/>
      <el-table-column label="过期时间" width="170">
        <template #default="{row}">{{row.expires_at||'永久'}}</template>
      </el-table-column>
      <el-table-column label="使用时间" prop="used_at" width="170"/>
    </el-table>
    <el-pagination class="pager" background layout="total, prev, pager, next" :total="total" :page-size="50" :current-page="page" @current-change="changePage"/>

    <el-dialog v-model="dialog" title="生成邀请码" width="460px">
      <el-form label-width="90px">
        <el-form-item label="数量"><el-input-number v-model="form.count" :min="1" :max="50"/></el-form-item>
        <el-form-item label="有效期"><el-input-number v-model="form.expiresInDays" :min="0" :max="365"/><span class="hint">天，0 表示永久</span></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" maxlength="100" placeholder="例如：2026级新生"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="create">生成</el-button></template>
    </el-dialog>

    <el-dialog v-model="createdDialog" title="邀请码已生成" width="420px">
      <p style="color:#929d87">请复制并发送给需要注册的人。关闭后仍可在列表中查看。</p>
      <div v-for="c in created" :key="c" class="created"><span class="code">{{c}}</span><el-button link type="primary" @click="copy(c)">复制</el-button></div>
    </el-dialog>
  </div>
</template>

<script setup>
import {ref,onMounted} from 'vue'
import {ElMessage} from 'element-plus'
import {foodGet,foodPost} from '@/api/food'
const rows=ref([]),total=ref(0),page=ref(1),status=ref(''),summary=ref({}),loading=ref(false)
const dialog=ref(false),createdDialog=ref(false),saving=ref(false),created=ref([])
const form=ref({count:1,expiresInDays:7,note:''})
async function load(){
  loading.value=true
  try{const res=await foodGet('/invites',{page:page.value,status:status.value});rows.value=res.data.rows;total.value=Number(res.data.total);summary.value=res.data.summary}
  finally{loading.value=false}
}
function search(){page.value=1;load()}
function changePage(p){page.value=p;load()}
function openCreate(){form.value={count:1,expiresInDays:7,note:''};dialog.value=true}
async function create(){
  saving.value=true
  try{const res=await foodPost('/invites',form.value);created.value=res.data.codes;dialog.value=false;createdDialog.value=true;page.value=1;load();ElMessage.success('已生成 '+created.value.length+' 个邀请码')}
  finally{saving.value=false}
}
function expired(row){if(!row.expires_at)return false;return new Date(String(row.expires_at).replace(/-/g,'/'))<=new Date()}
function statusLabel(row){return row.used_by?'已使用':expired(row)?'已过期':'未使用'}
function tagType(row){return row.used_by?'info':expired(row)?'warning':'success'}
function copy(text){
  const done=()=>ElMessage.success('已复制')
  if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done))
  else fallbackCopy(text,done)
}
function fallbackCopy(text,done){const el=document.createElement('textarea');el.value=text;document.body.appendChild(el);el.select();document.execCommand('copy');document.body.removeChild(el);done()}
onMounted(load)
</script>

<style scoped>
.toolbar{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.summary{color:#87927d;font-size:13px}
.code{font-family:Consolas,monospace;font-weight:700;letter-spacing:1px;color:#3f7050}
.pager{margin-top:18px;justify-content:flex-end}
.hint{margin-left:10px;color:#929d87}
.created{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid #e4e9dc;border-radius:8px;margin-bottom:10px}
</style>
