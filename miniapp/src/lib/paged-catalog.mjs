export function createPagedCatalog(state,fetchPage){
 let revision=0,query={}
 async function load(nextQuery,append=false){
  if(append&&(state.loading||state.rows.length>=state.total))return
  const ticket=++revision,page=append?state.page+1:1
  if(!append){query={...nextQuery};state.rows=[];state.total=0;state.page=1}
  state.loading=true;state.error=''
  try{const data=await fetchPage({...query,page});if(ticket!==revision)return;const ids=new Set(append?state.rows.map(r=>r.id):[]);state.rows=append?[...state.rows,...data.rows.filter(r=>!ids.has(r.id))]:data.rows;state.total=data.total;state.page=page}
  catch(e){if(ticket===revision)state.error=e.message}
  finally{if(ticket===revision)state.loading=false}
 }
 function cancel(){revision++;state.loading=false}
 return{load,cancel}
}
export const queryString=params=>Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&')
