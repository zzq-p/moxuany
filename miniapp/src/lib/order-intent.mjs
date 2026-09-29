export function cartSignature(cart){return JSON.stringify({storeId:cart.storeId,items:cart.items.map(p=>({id:p.id,specId:p.specId||null,addonIds:[...(p.addonIds||[])].sort((a,b)=>a-b),quantity:p.quantity,price:p.price})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})}
export function createIntentManager(storage){
 const key='food-checkout-intent-v1',read=()=>storage.get(key)||null
 function begin(memberId,body,signature){if(read())throw Error('请先处理上一次待确认订单');const value={memberId,body:JSON.parse(JSON.stringify(body)),signature,createdAt:Date.now()};storage.set(key,value);return value}
 function own(memberId){const value=read();if(value&&value.memberId!==memberId)throw Error('待确认订单属于其他账号，请切回原账号后处理');return value}
 function resolved(memberId,order){const value=own(memberId);if(!value)return;storage.set(key,{...value,orderId:order.id});return value}
 function rejected(memberId,requestKey){const value=own(memberId);if(value?.body.requestKey===requestKey)storage.remove(key)}
 function settled(memberId,orderId){const value=own(memberId);if(value?.orderId===orderId)storage.remove(key)}
 return {read,begin,own,resolved,rejected,settled}
}
