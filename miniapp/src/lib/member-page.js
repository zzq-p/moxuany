import {ref,watch} from 'vue'
import {state,request,ensureLogin,login} from './api'

// Keep member-only page data and responses scoped to the session that loaded them.
export function useMemberPage(fetchData,applyData,reset){
 const loading=ref(false),busy=ref(false),error=ref('')
 let version=0
 const context=()=>{
  const token=state.token,revision=state.authRevision
  const current=()=>!!token&&!state.signedOut&&token===state.token&&revision===state.authRevision
  const assertCurrent=()=>{if(!current())throw Error('登录状态已变化，请重新操作')}
  return {current,assertCurrent,request:(path,method='GET',data)=>{assertCurrent();return request(path,method,data,true,token)}}
 }
 watch(()=>[state.token,state.authRevision],()=>{loading.value=false;error.value='';reset()},{flush:'sync'})
 async function load(){
  const ticket=++version,revision=state.authRevision
  let session
  loading.value=true;error.value=''
  try{
   await ensureLogin()
   if(ticket!==version||revision!==state.authRevision||state.signedOut)return
   session=context();loading.value=true
   const data=await fetchData(session.request)
   if(ticket===version&&session.current())applyData(data)
  }catch(e){if(ticket===version&&revision===state.authRevision&&(!session||session.current()||!state.token))error.value=e.message||'加载失败，请重试'}
  finally{if(ticket===version)loading.value=false}
 }
 async function signIn(){
  if(busy.value)return
  busy.value=true;error.value=''
  try{await login();await load()}catch(e){error.value=e.message||'登录失败，请重试'}finally{busy.value=false}
 }
 async function run(action){
  if(busy.value)return
  if(!state.token){error.value='请先登录';return}
  const session=context();busy.value=true;error.value=''
  try{await action(session)}catch(e){if(session.current())error.value=e.message||'操作失败，请重试'}finally{busy.value=false}
 }
 return {loading,busy,error,load,signIn,run}
}
