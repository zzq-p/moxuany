import {configureProduct} from './options.mjs'
export function reconcileCart(items,products){
 const catalog=new Map(products.map(p=>[p.id,p])),next=[],remaining=new Map();let changed=false
 for(const old of items){const current=catalog.get(old.id);if(!current||current.stock<=0||current.active===0||current.available===false){changed=true;continue}
  try{const p=configureProduct(current,old.specId,old.addonIds),keys=['p:'+p.id,...[p.specId,...p.addonIds].filter(Boolean).map(id=>'o:'+id)];
   if(!remaining.has(keys[0]))remaining.set(keys[0],Math.min(99,Number(current.stock)));for(const o of current.options||[])if(!remaining.has('o:'+o.id))remaining.set('o:'+o.id,Number(o.stock))
   const quantity=Math.min(old.quantity,p.stock,99,...keys.map(k=>remaining.get(k)));if(quantity<=0){changed=true;continue}for(const k of keys)remaining.set(k,remaining.get(k)-quantity)
   if(quantity!==old.quantity||Number(old.price)!==p.price||old.option_text!==undefined&&old.option_text!==p.option_text)changed=true
   next.push({...p,quantity})
  }catch{changed=true}
 }
 return{items:next,changed}
}
