// A newer filter/account/page refresh owns the view; late requests cannot overwrite it.
export function createOrderFeed(state, fetchPage) {
  let revision = 0
  let filter = {type:'DELIVERY',status:''}
  async function reset(nextFilter, background = false) {
    if(background && state.loading)return
    const ticket=++revision
    filter={...nextFilter}
    state.loading=true;state.error=''
    if(!background){state.rows=[];state.page=1;state.hasMore=false}
    try {
      const rows=await fetchPage({...filter,page:1})
      if(ticket!==revision)return
      state.rows=rows;state.page=1;state.hasMore=rows.length===20
    }catch(e){if(ticket===revision)state.error=e.message}
    finally{if(ticket===revision)state.loading=false}
  }
  async function more(){
    if(state.loading||!state.hasMore)return
    const ticket=revision,nextPage=state.page+1
    state.loading=true;state.error=''
    try{
      const rows=await fetchPage({...filter,page:nextPage})
      if(ticket!==revision)return
      const ids=new Set(state.rows.map(o=>o.id))
      state.rows.push(...rows.filter(o=>!ids.has(o.id)));state.page=nextPage;state.hasMore=rows.length===20
    }catch(e){if(ticket===revision)state.error=e.message}
    finally{if(ticket===revision)state.loading=false}
  }
  function cancel(){revision++;state.loading=false}
  return {reset,more,cancel}
}
