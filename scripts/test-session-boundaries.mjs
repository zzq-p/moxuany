import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {cartSignature} from '../miniapp/src/lib/order-intent.mjs'
import {reconcileCart} from '../miniapp/src/lib/checkout.mjs'
const require=createRequire(new URL('../miniapp/package.json',import.meta.url))
const vue=require('vue'),compiler=require('@vue/compiler-sfc')
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8')
function strip(source){
 const nodes=compiler.babelParse(source,{sourceType:'module'}).program.body.filter(n=>n.type==='ImportDeclaration')
 for(const n of nodes.reverse())source=source.slice(0,n.start)+source.slice(n.end)
 return source.replace(/\bexport /g,'')
}
const evaluate=(source,env)=>new Function(...Object.keys(env),source)(...Object.values(env))
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const stateFor=()=>vue.reactive({token:'A',authRevision:0,memberId:1,signedOut:false})
function sessionFor(state,request){return evaluate(strip(read('miniapp/src/lib/session.js'))+';return captureSession',{state,request})}

// A member operation must not continue using another account after any await.
for(const boundary of ['ensure','read','write']){
 const state=stateFor(),held=deferred(),entered=deferred(),writes=[],toasts=[]
 const request=async(path,method,data,quiet,token)=>{
  if(method==='POST')writes.push({token,data})
  if((boundary==='read'&&method==='GET')||(boundary==='write'&&method==='POST')){entered.resolve();await held.promise}
  return method==='POST'?null:{stores:[{id:4}],products:[]}
 }
 const scope=vue.effectScope()
 const mod=scope.run(()=>evaluate(strip(read('miniapp/src/lib/favorites.js'))+';return {toggleFavorite,favorites}',{
  ...vue,state,request,captureSession:sessionFor(state,request),toast:t=>toasts.push(t),
  ensureLogin:async()=>{if(boundary==='ensure'){entered.resolve();await held.promise}}
 }))
 const pending=mod.toggleFavorite('STORE',4);await entered.promise
 state.token='B';state.authRevision++;held.resolve();await pending
 assert.equal(writes.length,boundary==='write'?1:0)
 assert(writes.every(w=>w.token==='A'))
 assert.deepEqual(mod.favorites.stores,[]);assert.equal(toasts.length,0);scope.stop()
}
{
 const state=stateFor(),writes=[];let saved=false
 const request=async(path,method,data,quiet,token)=>{if(method==='POST'){writes.push({token,...data});saved=data.favorite}return {stores:saved?[{id:4}]:[],products:[]}}
 const scope=vue.effectScope(),mod=scope.run(()=>evaluate(strip(read('miniapp/src/lib/favorites.js'))+';return {toggleFavorite,favorites}',{...vue,state,request,captureSession:sessionFor(state,request),toast(){},ensureLogin:async()=>{}}))
 await mod.toggleFavorite('STORE',4);assert.equal(writes[0].favorite,true);assert.equal(mod.favorites.stores[0].id,4)
 await mod.toggleFavorite('STORE',4);assert.equal(writes[1].favorite,false);assert.deepEqual(mod.favorites.stores,[])
 state.token='';assert.deepEqual(mod.favorites.stores,[]);scope.stop()
}
console.log('PASS favorites: normal add/remove, logout cache reset and account switches during login/read/write')

for(const boundary of ['response','confirm','cart-response','cart-confirm','cancel','success']){
 const state=stateFor(),held=deferred(),entered=deferred(),cart={storeId:2,items:[{id:2,quantity:1,price:200}],scheduledAt:''}
 let saves=0,navigations=0,confirmations=0
 const request=async()=>{
  if(['response','cart-response'].includes(boundary)){entered.resolve();await held.promise}
  return {storeId:1,items:[{id:1,quantity:2,price:100}],products:[{id:1,price:100,stock:10,active:1,options:[]}]}
 }
 const mod=evaluate(strip(read('miniapp/src/lib/reorder.js'))+';return {reorder}',{request,cart,reconcileCart,cartSignature,captureSession:sessionFor(state,request),saveCart(){saves++},go(){navigations++},toast(){},confirm:async()=>{
  confirmations++;if(['confirm','cart-confirm'].includes(boundary)){entered.resolve();await held.promise}return boundary!=='cancel'
 }})
 const result=mod.reorder('order-A')
 if(!['cancel','success'].includes(boundary)){
  const rejected=assert.rejects(result,boundary.startsWith('cart-')?/购物车已变化/:/登录状态已变化/)
  await entered.promise
  if(boundary.startsWith('cart-'))cart.items[0].quantity=3
  else{state.token='B';state.authRevision++}
  held.resolve();await rejected
 }else await result
 assert.equal(saves,boundary==='success'?1:0);assert.equal(navigations,saves)
 assert.equal(cart.storeId,boundary==='success'?1:2)
 if(boundary==='response')assert.equal(confirmations,0)
}
console.log('PASS reorder: account/cart changes during fetch and confirmation never overwrite cart; cancel and success work')

function orderPage(state,request,extra={}){
 const {descriptor}=compiler.parse(read('miniapp/src/pages/order/index.vue'))
 const source=strip(compiler.compileScript(descriptor,{id:'audit'}).content).replace('default','return')
 const hooks={},scope=vue.effectScope()
 const bindings=scope.run(()=>evaluate(source,{...vue,AfterSale:{},OrderExtras:{},PageHead:{},onLoad(){},onShow:f=>hooks.show=f,onHide:f=>hooks.hide=f,onUnload:f=>hooks.unload=f,state,captureSession:sessionFor(state,request),intents:{read:()=>null},money:x=>x,statuses:{},go(){},toast(){},confirm:async()=>true,...extra}).setup({}, {expose(){}}))
 bindings.id.value='order-A'
 return {bindings,hooks,close(){hooks.unload();scope.stop()}}
}
{
 const state=stateFor();let expired=false
 const page=orderPage(state,async()=>{if(expired){state.token='';throw Object.assign(Error('expired'),{code:401})}return {id:'order-A',status:'PENDING',address:'private address'}})
 await page.bindings.load();assert.equal(page.bindings.order.value.address,'private address')
 page.bindings.review.value='private draft';expired=true;await page.bindings.load()
 assert.deepEqual(page.bindings.order.value,{});assert.equal(page.bindings.review.value,'');assert.match(page.bindings.error.value,/登录/);page.close()
}
for(const boundary of ['response','confirmation','hide']){
 const state=stateFor(),held=deferred(),entered=deferred(),writes=[];let hold=false
 const page=orderPage(state,async(path,method,data,quiet,token)=>{
  if(method==='POST')writes.push({token})
  if(hold&&boundary!=='confirmation'){entered.resolve();await held.promise}
  return {id:'order-A',status:'UNPAID',address:'private address'}
 },{confirm:async()=>{entered.resolve();await held.promise;return true}})
 await page.bindings.load();hold=true
 const task=boundary==='confirmation'?page.bindings.act('pay'):page.bindings.load()
 await entered.promise
 if(boundary==='hide')page.hooks.hide()
 else{state.token='B';state.authRevision++}
 held.resolve();await task
 assert.equal(writes.length,0)
 if(boundary!=='hide')assert.deepEqual(page.bindings.order.value,{})
 page.close()
}
console.log('PASS order detail: 401 clears private fields; old responses and confirmation actions are discarded on session/lifecycle changes')

function childComponent(name,state,request,extra={}){
 const {descriptor}=compiler.parse(read('miniapp/src/components/'+name+'.vue'))
 const source=strip(compiler.compileScript(descriptor,{id:name}).content).replace('default','return')
 let unmount=()=>{};const scope=vue.effectScope()
 const bindings=scope.run(()=>evaluate(source,{...vue,captureSession:sessionFor(state,request),money:x=>x,request,toast(){},confirm:async()=>true,onMounted(){},onBeforeUnmount:f=>unmount=f,...extra}).setup({order:{id:'order-A',status:'PENDING',items:[]}}, {expose(){},emit(){}}))
 return {bindings,close(){unmount();scope.stop()}}
}
for(const boundary of ['quote','confirmation','preview','choose','upload','success']){
 const state=stateFor(),held=deferred(),entered=deferred(),writes=[],toasts=[];let confirmations=0,uploads=0
 const request=async(path,method,data,quiet,token)=>{
  if(path.endsWith('/refund'))writes.push({token})
  if((boundary==='quote'&&path.endsWith('/refund-quote'))||boundary==='preview'){entered.resolve();await held.promise}
  return path.startsWith('/evidence')?'private image':{kind:'FULL',amount:100}
 }
 const page=childComponent('AfterSale',state,request,{toast:t=>toasts.push(t),confirm:async()=>{confirmations++;if(boundary==='confirmation'){entered.resolve();await held.promise}return true},uni:{chooseImage:async options=>{
  if(boundary==='choose'){entered.resolve();await held.promise}options.success({tempFilePaths:['local-image']})
 }},uploadEvidence:async(id,path,token)=>{uploads++;assert.equal(token,'A');if(boundary==='upload'){entered.resolve();await held.promise}return {id:'evidence-A'}}})
 page.bindings.reason.value='退款原因'
 const task=boundary==='preview'?page.bindings.preview('evidence-A'):['choose','upload'].includes(boundary)?page.bindings.upload():page.bindings.submit()
 if(boundary!=='success'){await entered.promise;state.token='B';state.authRevision++;page.close();held.resolve()}
 await task
 assert.equal(writes.length,boundary==='success'?1:0)
 assert.equal(page.bindings.previewImage.value,'');assert.deepEqual(page.bindings.evidenceIds.value,[])
 if(boundary==='quote')assert.equal(confirmations,0)
 if(boundary==='choose')assert.equal(uploads,0)
 if(boundary!=='success')assert.equal(toasts.length,0)
 else {assert.equal(writes[0].token,'A');page.close()}
}
{
 const state=stateFor(),writes=[];let callback
 const page=childComponent('OrderExtras',state,async(path,method,data,quiet,token)=>writes.push({token}),{reorder:async()=>{},uni:{requestSubscribeMessage:options=>callback=options.success}})
 page.bindings.templates.value=[{template_id:'template-A',event:'READY'}]
 page.bindings.subscribe();state.token='B';page.close();await callback({'template-A':'accept'})
 assert.equal(writes.length,0)
}
console.log('PASS after-sale and subscription dialogs: old quotes/images/uploads/confirmations cannot survive an account switch; normal refund submission works')
