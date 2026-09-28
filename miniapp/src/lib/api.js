import { reactive } from 'vue'
let base=import.meta.env.VITE_API_BASE || ''
// #ifdef MP-WEIXIN
base=import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8080'
// #endif
export const money=n=>(Number(n||0)/100).toFixed(2).replace(/\.00$/,'')
export const state=reactive({token:uni.getStorageSync('food-token')||'',config:{demoEnabled:false}})
function normalizeAssets(data){if(Array.isArray(data))return data.map(normalizeAssets);if(data&&typeof data==='object'){for(const [k,v] of Object.entries(data)){if((k==='image'||k==='store_image')&&typeof v==='string'&&v.startsWith('/profile/'))data[k]=base+v;else if(v&&typeof v==='object')normalizeAssets(v)}}return data}
export function request(path,method='GET',data,quiet=false){return new Promise((resolve,reject)=>uni.request({url:base+'/food/app'+path,method,data,timeout:10000,header:{'X-Food-Token':state.token},success:({data:res,statusCode})=>{if(res.code===200)return resolve(normalizeAssets(res.data));if(res.code===401||statusCode===401){state.token='';uni.removeStorageSync('food-token')}const error=new Error(res.msg||'服务暂不可用');if(!quiet)uni.showToast({title:error.message,icon:'none'});reject(error)},fail:()=>{const error=new Error('连接失败，请检查服务和网络');if(!quiet)uni.showToast({title:error.message,icon:'none'});reject(error)}}))}
export async function login(){state.config=await request('/config');let payload={mode:'demo'};if(!state.config.demoEnabled){
// #ifdef MP-WEIXIN
 const result=await new Promise((resolve,reject)=>uni.login({provider:'weixin',success:resolve,fail:reject}));payload={code:result.code};
// #endif
// #ifdef H5
 throw new Error('请在微信小程序中登录');
// #endif
}const result=await request('/login','POST',payload);state.token=result.token;uni.setStorageSync('food-token',result.token);return result}
export async function ensureLogin(){if(!state.token)await login()}
export const go=(path)=>uni.navigateTo({url:'/pages/'+path})
export const toast=title=>uni.showToast({title,icon:'none'})
export const confirm=content=>new Promise(resolve=>uni.showModal({title:'温馨提示',content,success:r=>resolve(r.confirm)}))
export const statuses={UNPAID:'待支付',PENDING:'待接单',PREPARING:'制作中',DELIVERING:'配送中',READY:'待取餐',COMPLETED:'已完成',CANCELLED:'已取消'}
export const cart=reactive(uni.getStorageSync('food-cart')||{storeId:null,items:[]})
export function saveCart(){uni.setStorageSync('food-cart',{storeId:cart.storeId,items:cart.items})}
export function clearCart(){cart.storeId=null;cart.items=[];saveCart()}
export function key(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2)}
