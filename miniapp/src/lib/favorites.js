import {reactive} from 'vue'
import {state,request,ensureLogin,toast} from './api'
export const favorites=reactive({stores:[],products:[]})
export async function loadFavorites(){if(!state.token){favorites.stores=[];favorites.products=[];return}const token=state.token;const data=await request('/favorites','GET',null,true);if(token===state.token)Object.assign(favorites,data)}
export const isFavorite=(kind,id)=>favorites[kind==='STORE'?'stores':'products'].some(x=>x.id===id)
let busy=false
export async function toggleFavorite(kind,id){if(busy)return;busy=true;try{await ensureLogin();await loadFavorites();const favorite=!isFavorite(kind,id);await request('/favorites','POST',{kind,id,favorite});await loadFavorites();toast(favorite?'已收藏':'已取消收藏')}catch(e){toast(e.message)}finally{busy=false}}
