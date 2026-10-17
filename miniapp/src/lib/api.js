import { reactive } from 'vue'
import {createIntentManager} from './order-intent.mjs'
let base=import.meta.env.VITE_API_BASE || ''
// #ifdef MP-WEIXIN
base=import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8080'
// #endif
export const money=n=>(Number(n||0)/100).toFixed(2).replace(/\.00$/,'')
export const state=reactive({memberId:0,token:uni.getStorageSync('food-token')||'',demoCredential:uni.getStorageSync('food-demo-credential')||'',signedOut:!!uni.getStorageSync('food-signed-out'),authRevision:0,config:{demoEnabled:false,mockPayment:true,webLoginEnabled:true,captchaEnabled:false}})
export const intents=createIntentManager({get:k=>uni.getStorageSync(k),set:(k,v)=>uni.setStorageSync(k,v),remove:k=>uni.removeStorageSync(k)})
function activateMember(memberId){intents.select(memberId);state.memberId=memberId}
export const LOGIN_REQUIRED='WEB_LOGIN_REQUIRED'
export const isLoginRequired=e=>!!e&&e.code===LOGIN_REQUIRED
function normalizeAssets(data){if(Array.isArray(data))return data.map(normalizeAssets);if(data&&typeof data==='object'){for(const [k,v] of Object.entries(data)){if((k==='image'||k==='store_image')&&typeof v==='string'&&v.startsWith('/profile/'))data[k]=base+v;else if(v&&typeof v==='object')normalizeAssets(v)}}return data}
export function request(path,method='GET',data,quiet=false,token=state.token){
 return new Promise((resolve,reject)=>uni.request({url:base+'/food/app'+path,method,data,timeout:10000,header:{'X-Food-Token':token},success:({data:res,statusCode})=>{
  if(res.code===200){
   if(path==='/me'&&token&&token===state.token&&!state.signedOut){
    activateMember(res.data.id)
    if(res.data.demoCredential){state.demoCredential=res.data.demoCredential;uni.setStorageSync('food-demo-credential',res.data.demoCredential)}
   }
   return resolve(normalizeAssets(res.data))
  }
  if((res.code===401||statusCode===401)&&token===state.token){state.token='';state.memberId=0;uni.removeStorageSync('food-token')}
  const error=new Error(res.msg||'服务暂不可用');error.code=res.code||statusCode;if(!quiet)uni.showToast({title:error.message,icon:'none'});reject(error)
 },fail:()=>{const error=new Error('连接失败，请检查服务和网络');if(!quiet)uni.showToast({title:error.message,icon:'none'});reject(error)}}))
}
let loginAttempt
function acceptSession(result){
 state.token=result.token;activateMember(result.memberId);state.signedOut=false
 uni.removeStorageSync('food-signed-out');uni.setStorageSync('food-token',result.token)
 if(result.demoCredential){state.demoCredential=result.demoCredential;uni.setStorageSync('food-demo-credential',result.demoCredential)}
 else{state.demoCredential='';uni.removeStorageSync('food-demo-credential')}
 return result
}
export function loadConfig(){return request('/config','GET',null,true).then(c=>{state.config=c;return c})}
export function loadCaptcha(){return request('/captcha', 'GET', null, true)}
export function webLogin({account,password,captchaCode,captchaUuid}){
 return request('/login','POST',{mode:'web',account,password,captchaCode:captchaCode||'',captchaUuid:captchaUuid||''},true).then(acceptSession)
}
export function webRegister({account,password,nickname,inviteCode,captchaCode,captchaUuid}){
 return request('/register','POST',{account,password,nickname:nickname||'',inviteCode,captchaCode:captchaCode||'',captchaUuid:captchaUuid||''},true).then(acceptSession)
}
function currentPath(){const pages=getCurrentPages();const page=pages[pages.length-1];if(!page)return '';const options=page.options||{};const query=Object.keys(options).map(k=>k+'='+encodeURIComponent(options[k])).join('&');return '/'+page.route+(query?'?'+query:'')}
let loginOpening=false
export function openLogin(redirect){
 if(loginOpening)return
 loginOpening=true;setTimeout(()=>{loginOpening=false},800)
 const target=redirect||currentPath();const url='/pages/login/index'+(target?'?redirect='+encodeURIComponent(target):'')
 uni.navigateTo({url,fail:()=>uni.reLaunch({url})})
}
export function login(){if(!loginAttempt){const attempt=performLogin(state.authRevision).finally(()=>{if(loginAttempt===attempt)loginAttempt=null});loginAttempt=attempt}return loginAttempt}
async function performLogin(revision){state.config=await request('/config');if(revision!==state.authRevision)throw Error('登录已取消');let payload={mode:'demo',...(uni.getStorageSync('food-demo-credential')?{demoCredential:uni.getStorageSync('food-demo-credential')}:{})};if(!state.config.demoEnabled){
// #ifdef MP-WEIXIN
 const result=await new Promise((resolve,reject)=>uni.login({provider:'weixin',success:resolve,fail:reject}));payload={code:result.code};
// #endif
// #ifdef H5
 const error=new Error('请先登录');error.code=LOGIN_REQUIRED;throw error;
// #endif
}if(revision!==state.authRevision)throw Error('登录已取消');const result=await request('/login','POST',payload);if(revision!==state.authRevision){request('/logout','POST',null,true,result.token).catch(()=>{});throw Error('登录已取消')}return acceptSession(result)}
export async function ensureLogin(){if(!state.token){if(state.signedOut)throw Error('已退出登录，请前往“我的”点击登录');await login()}}
export async function logout(){
 const token=state.token,credential=state.demoCredential;state.authRevision++;loginAttempt=null
 state.token='';state.memberId=0;state.demoCredential='';state.signedOut=true
 uni.setStorageSync('food-signed-out',true)
 for(const key of ['food-token','food-demo-credential','food-selected-address'])uni.removeStorageSync(key)
 clearCart()
 // Local sign-out is immediate, including when the network is unavailable.
 if(token||credential)try{await request('/logout','POST',{demoCredential:credential},true,token)}catch{}
}
export const go=(path)=>uni.navigateTo({url:'/pages/'+path})
export const toast=title=>uni.showToast({title,icon:'none'})
export const confirm=content=>new Promise(resolve=>uni.showModal({title:'温馨提示',content,success:r=>resolve(r.confirm)}))
export const statuses={UNPAID:'待支付',PENDING:'待接单',PREPARING:'制作中',DELIVERING:'配送中',READY:'待取餐',COMPLETED:'已完成',CANCELLED:'已取消',REFUNDED:'已退款',WAITING_DELIVERY:'待骑手接单'}
export const cart=reactive(uni.getStorageSync('food-cart')||{storeId:null,items:[]})
export function saveCart(){uni.setStorageSync('food-cart',{storeId:cart.storeId,items:cart.items,scheduledAt:cart.scheduledAt||''})}
export function clearCart(){cart.storeId=null;cart.items=[];cart.scheduledAt='';saveCart()}
export function uploadEvidence(orderId,filePath,token=state.token){return new Promise((resolve,reject)=>uni.uploadFile({url:base+'/food/app/orders/'+orderId+'/evidence',filePath,name:'file',header:{'X-Food-Token':token},success:r=>{try{const data=JSON.parse(r.data);if(data.code!==200)throw Error(data.msg||'上传失败');resolve(data.data)}catch(e){reject(e)}},fail:()=>reject(Error('图片上传失败，请重试'))}))}
export function key(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2)}
