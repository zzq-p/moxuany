export function cartSignature(cart){return JSON.stringify({storeId:cart.storeId,scheduledAt:cart.scheduledAt||'',items:cart.items.map(p=>({id:p.id,specId:p.specId||null,addonIds:[...(p.addonIds||[])].sort((a,b)=>a-b),quantity:p.quantity,price:p.price})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})}
export function matchesIntentCart(cart,intent){
 if(cartSignature(cart)===intent.signature)return true
 // Old signatures lacked the date; only migrate it from the original submitted body.
 try{const old=JSON.parse(intent.signature);if(Object.hasOwn(old,'scheduledAt'))return false;return cartSignature(cart)===cartSignature({...old,scheduledAt:intent.body.scheduledAt||''})}catch{return false}
}
export function createIntentManager(storage){
 const key='food-checkout-intent-v1',read=()=>storage.get(key)||null
 function select(memberId){
  const value=read();if(value?.memberId===memberId)return
  // Preserve unresolved requests from other accounts, including legacy v1 records.
  if(value)storage.set(key+':member:'+value.memberId,value)
  const saved=storage.get(key+':member:'+memberId)
  if(saved){storage.set(key,saved);storage.remove(key+':member:'+memberId)}else storage.remove(key)
 }
 function begin(memberId,body,signature){if(read())throw Error('请先处理上一次待确认订单');const value={memberId,body:JSON.parse(JSON.stringify(body)),signature,createdAt:Date.now()};storage.set(key,value);return value}
 function own(memberId){const value=read();if(value&&value.memberId!==memberId)throw Error('待确认订单属于其他账号，请切回原账号后处理');return value}
 function resolved(memberId,order){const value=own(memberId);if(!value)return;storage.set(key,{...value,orderId:order.id});return value}
 function rejected(memberId,requestKey){const value=own(memberId);if(value?.body.requestKey===requestKey)storage.remove(key)}
 function settled(memberId,orderId){const value=own(memberId);if(value?.orderId===orderId)storage.remove(key)}
 return {read,select,begin,own,resolved,rejected,settled}
}
