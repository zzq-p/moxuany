export function lineKey(p){return p.id+':'+(p.specId||'')+':'+[...(p.addonIds||[])].sort((a,b)=>a-b).join(',')}
export function configureProduct(product,specId=null,addonIds=[]){
 const options=product.options||[],specs=options.filter(o=>o.kind==='SPEC'),spec=options.find(o=>o.id===specId&&o.kind==='SPEC')
 if(specs.length&&!spec||specId&&!spec)throw Error('请选择有效规格')
 const adds=addonIds.map(id=>options.find(o=>o.id===id&&o.kind==='ADDON'))
 if(adds.some(o=>!o)||new Set(addonIds).size!==addonIds.length||adds.length>10)throw Error('加料选项已变化')
 const selected=[...(spec?[spec]:[]),...adds],p={...product,specId:spec?.id||null,addonIds:adds.map(o=>o.id).sort((a,b)=>a-b),price:Number(spec?.price??product.price)+adds.reduce((n,o)=>n+Number(o.price),0),stock:Math.min(product.stock,...selected.map(o=>o.stock)),option_text:selected.map(o=>o.name).join(' / ')}
 return {...p,product_stock:Number(product.stock),lineKey:lineKey(p)}
}
export function availableToAdd(items,product){
 const sameProduct=items.filter(p=>p.id===product.id)
 const used=sameProduct.reduce((n,p)=>n+Number(p.quantity),0)
 let remaining=Math.min(99,Number(product.product_stock??product.stock))-used
 for(const id of [product.specId,...(product.addonIds||[])].filter(Boolean)){
  const option=product.options?.find(o=>o.id===id)
  const occupied=sameProduct.filter(p=>p.specId===id||(p.addonIds||[]).includes(id)).reduce((n,p)=>n+Number(p.quantity),0)
  remaining=Math.min(remaining,Number(option?.stock||0)-occupied)
 }
 return Math.max(0,remaining)
}
