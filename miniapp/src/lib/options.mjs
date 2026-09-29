export function lineKey(p){return p.id+':'+(p.specId||'')+':'+[...(p.addonIds||[])].sort((a,b)=>a-b).join(',')}
export function configureProduct(product,specId=null,addonIds=[]){
 const options=product.options||[],specs=options.filter(o=>o.kind==='SPEC'),spec=options.find(o=>o.id===specId&&o.kind==='SPEC')
 if(specs.length&&!spec||specId&&!spec)throw Error('请选择有效规格')
 const adds=addonIds.map(id=>options.find(o=>o.id===id&&o.kind==='ADDON'))
 if(adds.some(o=>!o)||new Set(addonIds).size!==addonIds.length||adds.length>10)throw Error('加料选项已变化')
 const selected=[...(spec?[spec]:[]),...adds],p={...product,specId:spec?.id||null,addonIds:adds.map(o=>o.id).sort((a,b)=>a-b),price:Number(spec?.price??product.price)+adds.reduce((n,o)=>n+Number(o.price),0),stock:Math.min(product.stock,...selected.map(o=>o.stock)),option_text:selected.map(o=>o.name).join(' / ')}
 return {...p,lineKey:lineKey(p)}
}
