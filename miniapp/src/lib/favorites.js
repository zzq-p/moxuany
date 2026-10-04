import {reactive,watch} from 'vue'
import {state,ensureLogin,toast} from './api'
import {captureSession} from './session'
export const favorites=reactive({stores:[],products:[]})
function reset(){favorites.stores=[];favorites.products=[]}
watch(()=>[state.token,state.authRevision],reset,{flush:'sync'})
export async function loadFavorites(session=captureSession()){
 if(!state.token){reset();return}
 const data=await session.request('/favorites')
 session.assertCurrent();Object.assign(favorites,data)
}
export const isFavorite=(kind,id)=>favorites[kind==='STORE'?'stores':'products'].some(x=>x.id===id)
let busy=false
export async function toggleFavorite(kind,id){
 if(busy)return;busy=true
 const revision=state.authRevision,initialToken=state.token
 let session
 try{
  await ensureLogin()
  if(revision!==state.authRevision||(initialToken&&initialToken!==state.token))return
  session=captureSession();await loadFavorites(session);session.assertCurrent()
  const favorite=!isFavorite(kind,id)
  await session.request('/favorites','POST',{kind,id,favorite})
  await loadFavorites(session);session.assertCurrent();toast(favorite?'已收藏':'已取消收藏')
 }catch(e){if(!session||session.current())toast(e.message)}finally{busy=false}
}
