<template><view class="page"><PageHead title="收货地址"/><view class="content"><view v-if="!state.token" class="card"><view class="bold">登录后管理收货地址</view><view class="subtitle">登录后可新增、编辑和选择收货地址。</view><button class="btn" :loading="busy" :disabled="busy" @click="signIn">立即登录</button></view><view v-if="error" class="error">{{error}}<text v-if="state.token" class="link" @click="load"> 点击重试</text></view><view v-if="loading" class="subtitle">加载中…</view><template v-if="state.token"><view v-for="a in addresses" :key="a.id" class="card"><view @click="select(a)"><view class="bold">{{a.detail}}</view><view class="subtitle">{{a.contact}} {{a.phone}}</view></view><view class="between" style="margin-top:22rpx"><text class="small link" @click="edit(a)">编辑</text><text class="small muted" @click="remove(a)">删除</text></view></view><view v-if="!loading&&!error&&!addresses.length&&!editing" class="empty"><view class="empty-symbol">⌖</view>添加地址，让美味找到你</view><view v-if="editing" class="card"><view class="title" style="font-size:30rpx">{{form.id?'编辑地址':'新增地址'}}</view><view style="margin-top:25rpx" class="label">联系人</view><input v-model="form.contact" placeholder="怎么称呼你" class="field" maxlength="50"/><text class="label">联系电话</text><input v-model="form.phone" placeholder="11位手机号" type="number" maxlength="11" class="field"/><text class="label">详细地址</text><input v-model="form.detail" @input="form.latitude=null;form.longitude=null" placeholder="校区、宿舍楼、楼层和门牌号" class="field" maxlength="250"/><view class="subtitle">请在地图标记实际收货点，商家会据此校验配送范围。修改地址后请重新选点。</view><button class="btn" style="margin-bottom:16rpx" :disabled="locating" @click="chooseMap">地图选收货点</button><button class="btn" :loading="locating" :disabled="locating" @click="locate">{{form.latitude!=null?'重新定位收货点':'在收货处定位'}}</button><view v-if="form.latitude!=null" class="subtitle">✓ 已标记收货点</view><view v-if="locationError" class="error">{{locationError}}</view><button class="btn" style="margin-top:20rpx" :loading="busy" :disabled="busy||locating" @click="save">保存地址</button></view><button v-else class="btn" @click="edit({})">＋ 新增收货地址</button></template></view></view></template>
<script setup>
import {ref} from 'vue'
import {onLoad,onShow} from '@dcloudio/uni-app'
import PageHead from '../../components/PageHead.vue'
import {state,confirm,toast} from '../../lib/api'
import {useMemberPage} from '../../lib/member-page'
import {acquire} from '../../lib/location'
import {fromGcj02} from '../../lib/map-point.mjs'
const addresses=ref([]),editing=ref(false),form=ref({}),selectMode=ref(false),locating=ref(false),locationError=ref('')
let mapNonce=''
const {loading,busy,error,load,signIn,run}=useMemberPage(
 request=>request('/addresses'),data=>addresses.value=data,
 ()=>{addresses.value=[];editing.value=false;form.value={};mapNonce='';locationError.value=''})
function edit(a){if(!state.token||busy.value)return;mapNonce='';locationError.value='';form.value={...a};editing.value=true}
function select(a){if(!state.token||!selectMode.value)return;uni.setStorageSync('food-selected-address',a.id);uni.navigateBack()}
async function save(){if(locating.value)return;await run(async session=>{await session.request('/addresses','POST',form.value);session.assertCurrent();editing.value=false;await load();if(session.current())toast('地址已保存')})}
async function remove(a){await run(async session=>{if(!await confirm('删除这个地址？'))return;await session.request('/addresses/'+a.id,'DELETE');session.assertCurrent();await load()})}
async function locate(){
 if(!state.token||locating.value)return
 const current=form.value;locating.value=true;locationError.value=''
 try{const p=await acquire();if(current===form.value){form.value.latitude=p.latitude;form.value.longitude=p.longitude}}
 catch{if(current===form.value)locationError.value='定位失败，请检查设备定位权限后重试'}finally{locating.value=false}
}
async function chooseMap(){
 if(!state.token||locating.value)return
 locationError.value=''
 // #ifdef H5
 mapNonce=Date.now()+'-'+Math.random().toString(36).slice(2);uni.removeStorageSync('food-map-result');uni.navigateTo({url:'/pages/map/index?nonce='+mapNonce+(form.value.latitude!=null?'&latitude='+form.value.latitude+'&longitude='+form.value.longitude:'')})
 // #endif
 // #ifndef H5
 locating.value=true;const current=form.value;uni.chooseLocation({success:p=>{if(current!==form.value)return;try{Object.assign(form.value,fromGcj02(p));if(!form.value.detail)form.value.detail=(p.address||'')+(p.name||'')}catch(e){locationError.value=e.message}},fail:()=>{if(current===form.value)locationError.value='未能选取位置，请检查小程序定位权限或使用现场定位'},complete:()=>locating.value=false})
 // #endif
}
onLoad(o=>{selectMode.value=o.select==='1'})
onShow(()=>{
 const p=uni.getStorageSync('food-map-result')
 if(state.token&&p&&mapNonce&&p.nonce===mapNonce&&editing.value){form.value.latitude=p.latitude;form.value.longitude=p.longitude;uni.removeStorageSync('food-map-result');mapNonce=''}
 if(!editing.value)load()
})
</script>
