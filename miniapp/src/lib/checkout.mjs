export function reconcileCart(items, products) {
  const catalog=new Map(products.map(p=>[p.id,p]))
  let changed=false
  const next=[]
  for(const old of items){
    const current=catalog.get(old.id)
    if(!current||current.stock<=0){changed=true;continue}
    const quantity=Math.min(old.quantity,current.stock,99)
    if(quantity!==old.quantity||Number(old.price)!==Number(current.price))changed=true
    next.push({...current,quantity})
  }
  return {items:next,changed}
}
