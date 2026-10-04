import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import {createPagedCatalog,queryString} from '../miniapp/src/lib/paged-catalog.mjs'
import {configureProduct,lineKey,availableToAdd} from '../miniapp/src/lib/options.mjs'
import {reconcileCart} from '../miniapp/src/lib/checkout.mjs'
import {createIntentManager,cartSignature,matchesIntentCart} from '../miniapp/src/lib/order-intent.mjs'
import {createOrderFeed} from '../miniapp/src/lib/order-feed.mjs'

const require=createRequire(new URL('../miniapp/package.json',import.meta.url))
const vue=require('vue'),compiler=require('@vue/compiler-sfc'),dom=require('@vue/compiler-dom')
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8')
function withoutImports(source){
 const imports=compiler.babelParse(source,{sourceType:'module'}).program.body.filter(n=>n.type==='ImportDeclaration')
 for(const node of imports.reverse())source=source.slice(0,node.start)+source.slice(node.end)
 return source
}
function evaluate(source,env){return new Function(...Object.keys(env),source)(...Object.values(env))}
function component(name,extra={}){
 const {descriptor}=compiler.parse(read('miniapp/src/pages/'+name+'/index.vue'))
 const source=withoutImports(compiler.compileScript(descriptor,{id:name}).content).replace('export default','return')
 const env={...vue,onShow(){},onHide(){},onUnload(){},onLoad(){},onReachBottom(){},PageHead:{},intents:{read:()=>null},cart:{storeId:1,items:[]},state:{memberId:1},key:()=> 'regression-key-000001',uni:{getStorageSync:()=>null},ensureLogin:async()=>{},memberIdentity:async()=>1,recoverOrder:async()=>false,openConfirmedOrder(){},orderSession:()=>({token:"test-token",memberId:1}),assertOrderSession(){},request:async()=>[],saveCart(){},clearCart(){},toast(){},go(){},money:x=>x,confirm:async()=>true,location:{},locationActions:{expire(){}},loadFavorites:async()=>{},isFavorite:()=>false,toggleFavorite(){},createPagedCatalog,queryString,configureProduct,lineKey,availableToAdd,reconcileCart,cartSignature,distanceMeters:()=>0,distanceText:()=>'',...extra}
 const scope=vue.effectScope()
 const bindings=scope.run(()=>evaluate(source,env).setup({}, {expose(){}}))
 function find(node){if(node.children?.some(c=>c.tag==='picker'))return node;for(const c of node.children||[]){const found=find(c);if(found)return found}}
 const wrapper=find(dom.parse(descriptor.template.content))
 return {bindings,close:()=>scope.stop(),timeControlsVisible(){
  const condition=wrapper.props.find(p=>p.type===7&&p.name==='if').exp.content
  return !!evaluate('with(ctx){return ('+condition+')}',{ctx:vue.proxyRefs(bindings)})
 },switchToAsap(){
  const button=wrapper.children.find(c=>c.tag==='button')
  const disabled=button.props.find(p=>p.type===7&&p.name==='bind'&&p.arg.content==='disabled').exp.content
  const ctx=vue.proxyRefs(bindings)
  assert(!evaluate('with(ctx){return ('+disabled+')}',{ctx}))
  const click=button.props.find(p=>p.type===7&&p.name==='on'&&p.arg.content==='click').exp.content
  return evaluate('with(ctx){return ('+click+')}',{ctx})
 }}
}

function recoveryFixture({token='expired',member=7,failCode}={}){
 const memory=new Map(),calls=[],state={memberId:7,token}
 const storage={get:k=>memory.get(k),set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)}
 const env={accountIntents:createIntentManager(storage),createIntentManager,cartSignature,matchesIntentCart,state,cart:{storeId:1,items:[]},clearCart(){},uni:{getStorageSync:storage.get,setStorageSync:storage.set,removeStorageSync:storage.remove,redirectTo(){}},ensureLogin:async()=>{if(!state.token){calls.push('login');state.token='fresh'}},request:async(path,method,body)=>{
  calls.push(path)
  if(path==='/me'){
   if(failCode)throw Object.assign(Error('identity failed'),{code:failCode})
   if(state.token==='expired'){state.token='';throw Object.assign(Error('expired'),{code:401})}
   return {id:member}
  }
  if(path.startsWith('/orders/by-request/'))return {found:false}
  if(path==='/orders'){assert.equal(body.requestKey,'original-request-0001');return {id:'order-1'}}
  throw Error('Unexpected request '+path)
 }}
 const recovery=evaluate(withoutImports(read('miniapp/src/lib/recovery.js')).replace(/\bexport /g,'')+'\nreturn {intents,memberIdentity,recoverOrder}',env)
 recovery.intents.begin(7,{requestKey:'original-request-0001'},'original-cart')
 return {...recovery,calls,state}
}

for(const token of ['expired','']){
 const recovery=recoveryFixture({token}),page=component('checkout',recovery)
 await page.bindings.loadCheckout()
 assert.equal(recovery.calls.filter(c=>c==='login').length,1)
 assert(recovery.calls.some(c=>c.startsWith('/orders/by-request/')))
 await page.bindings.recover(true)
 assert.equal(recovery.intents.read().orderId,'order-1')
 assert.equal(recovery.calls.filter(c=>c==='/orders').length,1)
 page.close()
}
for(const options of [{failCode:500},{failCode:401}]){
 const recovery=recoveryFixture(options),page=component('checkout',recovery)
 await page.bindings.recover(true)
 assert(!recovery.calls.some(c=>c.startsWith('/orders')))
 assert.equal(recovery.intents.read().memberId,7)
 assert.equal(page.bindings.pending.value,true)
 assert(recovery.calls.filter(c=>c==='/me').length<=2)
 page.close()
}
console.log('PASS expired/missing login recovery, original request key, account isolation, bounded retry and non-auth failures')

let releaseIdentity,recoveries=0
const identityWait=new Promise(resolve=>{releaseIdentity=resolve})
const concurrent=component('checkout',{intents:{read:()=>({memberId:7})},memberIdentity:()=>identityWait,recoverOrder:async()=>{recoveries++;return false}})
const firstRecovery=concurrent.bindings.recover(false)
await concurrent.bindings.recover(true)
releaseIdentity(7);await firstRecovery
assert.equal(recoveries,1);concurrent.close()
console.log('PASS repeated recovery clicks share one in-flight attempt')

const slot='2099-10-02T12:00:00',cart={storeId:1,items:[{id:1,quantity:2,price:100}],scheduledAt:slot},calls=[]
const page=component('checkout',{cart,request:async path=>{
 calls.push(path)
 if(path==='/stores/1/info')return {id:1,reservation_enabled:0,open_now:true}
 if(path.startsWith('/catalog/products?'))return {rows:[{id:1,stock:1,price:200,active:1,options:[]}]}
 return []
}})
await page.bindings.loadCheckout()
assert(page.timeControlsVisible());assert.match(page.bindings.blocked.value,/预约时段/)
await page.switchToAsap()
assert.equal(cart.scheduledAt,'');assert.equal(page.bindings.blocked.value,'')
assert.equal(cart.items[0].quantity,1);assert.equal(cart.items[0].price,200)
assert(!calls.find(c=>c.startsWith('/catalog/products?')).includes('scheduledAt'))
assert(!page.timeControlsVisible());page.close()
let confirmed=false
const storeCart={storeId:1,items:[{id:1,quantity:1}],scheduledAt:slot}
const storePage=component('store',{cart:storeCart,confirm:async()=>confirmed,clearCart(){storeCart.items=[];storeCart.scheduledAt='';storeCart.storeId=null},request:async()=>({rows:[],total:0})})
storePage.bindings.id.value=1;storePage.bindings.store.value={id:1,reservation_enabled:0};storePage.bindings.scheduledAt.value=slot
assert(storePage.timeControlsVisible())
await storePage.switchToAsap();assert.equal(storeCart.items.length,1)
confirmed=true;await storePage.switchToAsap()
assert.equal(storeCart.scheduledAt,'');assert.equal(storePage.bindings.scheduledAt.value,'');storePage.close()
console.log('PASS disabled reservations retain time controls; switching to ASAP refreshes stock/price; store confirmation preserves cancel')

const product={id:1,stock:1,price:100,available:true,options:[{id:11,kind:'SPEC',name:'A',price:100,stock:5},{id:12,kind:'SPEC',name:'B',price:200,stock:5},{id:13,kind:'ADDON',name:'egg',price:50,stock:1}]}
const shopCart={storeId:1,items:[]},shop=component('store',{cart:shopCart})
shop.bindings.id.value=1;shop.bindings.store.value={id:1,open_now:true}
const a=configureProduct(product,11),b=configureProduct(product,12)
await shop.bindings.change(a,1);await shop.bindings.change(b,1)
assert.equal(shopCart.items.length,1)
await shop.bindings.change(a,-1);await shop.bindings.change(b,1)
assert.equal(shopCart.items[0].specId,12)
shopCart.items=[]
const plentiful={...product,stock:10},eggA=configureProduct(plentiful,11,[13]),eggB=configureProduct(plentiful,12,[13])
await shop.bindings.change(eggA,1);await shop.bindings.change(eggB,1)
assert.equal(shopCart.items.length,1)
await shop.bindings.change(configureProduct(plentiful,12),1)
assert.equal(shopCart.items.length,2)
assert.equal(availableToAdd([{...a,quantity:2}],configureProduct({...plentiful,options:plentiful.options.map(o=>o.id===11?{...o,stock:2}:o)},11,[13])),0)
assert.equal(availableToAdd([{...a,quantity:99}],configureProduct({...product,stock:200},12)),0)
assert.equal(availableToAdd([{id:2,quantity:99}],b),1)
assert.equal(configureProduct(plentiful,11,[13]).product_stock,10)
assert.equal(availableToAdd([{id:3,quantity:1}],{id:3,stock:2}),1)
shopCart.items=[{...a,quantity:3}]
await shop.bindings.change({...a,stock:0,product_stock:0},-1)
assert.equal(shopCart.items[0].quantity,2)
shop.close()
console.log('PASS shared product/spec/addon stock, independent options, 99-item cap, other products, no-option products and decrement above stock')

// Different accounts keep independent pending requests, including legacy v1 storage.
{
 const recovery=recoveryFixture({member:8})
 await recovery.memberIdentity()
 assert.equal(recovery.intents.read(),null)
 recovery.intents.begin(8,{requestKey:'second-account-key'},'second-cart')
 recovery.intents.select(7)
 assert.equal(recovery.intents.read().body.requestKey,'original-request-0001')
 recovery.intents.select(8)
 assert.equal(recovery.intents.read().body.requestKey,'second-account-key')
 console.log('PASS switching accounts archives and restores pending requests without blocking the new account')
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function recoveryRuntime(extra={}){
 const memory=new Map(),state={token:'account-a',memberId:7,authRevision:0,signedOut:false},cart={storeId:1,scheduledAt:'2099-10-02T12:00:00',items:[{id:1,price:100,quantity:1}]}
 const effects={cleared:0,redirected:0}
 const env={accountIntents:createIntentManager({get:k=>memory.get(k),set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)}),createIntentManager,matchesIntentCart,state,cart,ensureLogin:async()=>{},clearCart(){effects.cleared++},uni:{getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,v),removeStorageSync:k=>memory.delete(k),redirectTo(){effects.redirected++}},...extra}
 const api=evaluate(withoutImports(read('miniapp/src/lib/recovery.js')).replace(/\bexport /g,'')+'\nreturn {intents,memberIdentity,recoverOrder,orderSession,assertOrderSession,openConfirmedOrder}',env)
 api.intents.begin(7,{requestKey:'original-key',scheduledAt:cart.scheduledAt},cartSignature(cart))
 return {...api,state,cart,effects}
}
for(const phase of ['lookup-missing','lookup-found','post-success','post-rejected','identity','identity-401']){
 const started=deferred(),waiting=deferred(),calls=[]
 const recovery=recoveryRuntime({request:async(path,method,body,quiet,token)=>{
  calls.push({path,token})
  if(path.startsWith('/orders/by-request/')&&phase.startsWith('post'))return {found:false}
  started.resolve();return waiting.promise
 }})
 const pending=phase.startsWith('identity')?recovery.memberIdentity():recovery.recoverOrder(true)
 const rejected=assert.rejects(pending,/登录状态已变化/)
 await started.promise
 recovery.state.authRevision++;recovery.state.token='account-b';recovery.state.memberId=8
 recovery.intents.select(8);recovery.intents.begin(8,{requestKey:'account-b-key'},'b-cart')
 if(phase==='post-rejected'||phase==='identity-401')waiting.reject(Object.assign(Error('failed'),{code:phase==='identity-401'?401:601}))
 else waiting.resolve(phase==='identity'?{id:7}:phase==='post-success'?{id:'a-order'}:{found:phase==='lookup-found',order:{id:'a-order'}})
 await rejected
 assert(calls.every(c=>c.token==='account-a'))
 assert.equal(calls.filter(c=>c.path==='/orders').length,phase.startsWith('post')?1:0)
 assert.equal(recovery.state.memberId,8);assert.equal(recovery.intents.read().body.requestKey,'account-b-key')
 recovery.intents.select(7);assert.equal(recovery.intents.read().body.requestKey,'original-key');assert.equal(recovery.intents.read().orderId,undefined)
 assert.deepEqual(recovery.effects,{cleared:0,redirected:0})
}
{
 const waiting=deferred(),started=deferred(),recovery=recoveryRuntime({request:async()=>{started.resolve();return waiting.promise}})
 const pending=recovery.recoverOrder(true),rejected=assert.rejects(pending,/待确认订单已变化/)
 await started.promise;recovery.intents.rejected(7,'original-key');recovery.intents.begin(7,{requestKey:'new-key'},'new-cart')
 waiting.resolve({found:false});await rejected;assert.equal(recovery.intents.read().body.requestKey,'new-key')
}
console.log('PASS account switches during identity, lookup, submit and rejection cannot create cross-account orders, replace intents, clear carts or redirect')
for(const legacy of [false,true])for(const changed of [false,true]){
 const recovery=recoveryRuntime()
 if(legacy){const old=JSON.parse(cartSignature(recovery.cart));delete old.scheduledAt;recovery.intents.rejected(7,'original-key');recovery.intents.begin(7,{requestKey:'original-key',scheduledAt:recovery.cart.scheduledAt},JSON.stringify(old))}
 if(changed)recovery.cart.scheduledAt='2099-10-03T12:00:00'
 recovery.openConfirmedOrder({id:'order-a'},recovery.orderSession())
 assert.equal(recovery.effects.cleared,changed?0:1);assert.equal(recovery.effects.redirected,1)
}
assert.equal(matchesIntentCart({storeId:1,items:[]},{signature:'corrupt',body:{}}),false)
console.log('PASS reservation date participates in cart matching, including safe migration of persisted legacy signatures')
{
 const started=deferred(),waiting=deferred(),recovery=recoveryRuntime({request:async()=>{}})
 recovery.intents.rejected(7,'original-key')
 const page=component('checkout',{...recovery,request:async(path,method,body,quiet,token)=>{assert.equal(token,'account-a');started.resolve();return waiting.promise}})
 page.bindings.store.value={id:1,open_now:true};page.bindings.type.value='PICKUP';page.bindings.scheduledAt.value=''
 const pending=page.bindings.submit();await started.promise
 recovery.state.authRevision++;recovery.state.token='account-b';recovery.state.memberId=8;recovery.intents.select(8)
 waiting.resolve({id:'old-account-order'});await pending
 assert.match(page.bindings.error.value,/登录状态已变化/);assert.deepEqual(recovery.effects,{cleared:0,redirected:0});page.close()
}
console.log('PASS regular checkout submission also ignores a response after an account switch')
for(const name of ['addresses','benefits']){
 const state=vue.reactive({token:'',signedOut:true,authRevision:1}),calls=[]
 let response,fail=false,confirmation=async()=>true,onLoad
 const request=async(path,method,body,quiet,token)=>{
  calls.push({path,method,token});assert.equal(token,state.token)
  if(fail)throw Error('network unavailable')
  if(response)return response.promise
  return path==='/me'?{id:7,points:100}:path==='/addresses'?[{id:42,detail:'saved address'}]:[{id:1,title:'coupon'}]
 }
 const useMemberPage=evaluate(withoutImports(read('miniapp/src/lib/member-page.js')).replace(/\bexport /g,'')+'\nreturn useMemberPage',{
  ...vue,state,request,ensureLogin:async()=>{if(!state.token)throw Error('已退出登录，请先登录')},login:async()=>{state.token='member-token';state.signedOut=false}
 })
 const storage=new Map(),page=component(name,{state,useMemberPage,confirm:()=>confirmation(),acquire:async()=>({latitude:1,longitude:1}),fromGcj02:x=>x,onLoad:fn=>onLoad=fn,uni:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),navigateBack(){}}})
 if(onLoad)onLoad({select:'1'})
 await page.bindings.load();assert.equal(calls.length,0);assert.match(page.bindings.error.value,/退出登录/)
 const template=compiler.parse(read('miniapp/src/pages/'+name+'/index.vue')).descriptor.template.content
 assert(template.includes('v-if="!state.token"'));assert(template.includes('@click="signIn"'));assert(template.includes('<template v-if="state.token">'))
 if(name==='addresses'){page.bindings.edit({});assert.equal(page.bindings.editing.value,false);await page.bindings.save()}
 else{await page.bindings.checkin();await page.bindings.redeem()}
 assert.equal(calls.length,0)
 await page.bindings.signIn();assert.equal(page.bindings.error.value,'');assert.equal(page.bindings.loading.value,false)
 if(name==='addresses'){assert.equal(page.bindings.addresses.value[0].id,42);page.bindings.select({id:42});assert.equal(storage.get('food-selected-address'),42)}
 else assert.equal(page.bindings.me.value.points,100)
 fail=true;await page.bindings.load();assert.match(page.bindings.error.value,/network unavailable/);fail=false
 // A dialog opened by one account must not issue a mutation for the next account.
 const dialog=deferred();confirmation=()=>dialog.promise
 const before=calls.length,action=name==='addresses'?page.bindings.remove({id:42}):page.bindings.redeem()
 state.authRevision++;state.token='other-token';dialog.resolve(true);await action;assert.equal(calls.length,before)
 response=deferred();const load=page.bindings.load();await Promise.resolve()
 state.authRevision++;state.token='';state.signedOut=true
 response.resolve(name==='addresses'?[{id:99}]:{id:99,points:999});await load
 if(name==='addresses')assert.deepEqual(page.bindings.addresses.value,[])
 else{assert.deepEqual(page.bindings.me.value,{});assert.deepEqual(page.bindings.coupons.value,[])}
 assert.equal(page.bindings.loading.value,false);page.close()
}
console.log('PASS addresses/benefits signed-out gates, explicit login, address selection, visible load errors, guarded confirmations and stale responses')
{
 let pending=null,recovered=0,requests=0
 const page=component('checkout',{intents:{read:()=>pending},memberIdentity:async()=>{pending={memberId:7}},recoverOrder:async()=>{recovered++;return false},request:async()=>{requests++;return []}})
 await page.bindings.loadCheckout()
 assert.equal(recovered,1);assert.equal(requests,0);assert.equal(page.bindings.pending.value,true);page.close()
 console.log('PASS restored account pending request is recovered before loading a new checkout')
}
for(const mutation of ['store','quantity','schedule','hide','unload']){
 const cart={storeId:1,scheduledAt:'',items:[{id:1,price:100,quantity:1}]},waiting=deferred(),started=deferred();let hide,unload,saved=0
 const page=component('checkout',{cart,onHide:fn=>hide=fn,onUnload:fn=>unload=fn,saveCart(){saved++},request:async url=>{
  if(url==='/stores/1/info')return {id:1,open_now:true}
  if(url.startsWith('/catalog/products?')){started.resolve();return waiting.promise}
  return []
 }})
 const load=page.bindings.loadCheckout();await started.promise
 if(mutation==='store'){cart.storeId=2;cart.items=[{id:2,price:200,quantity:1}]}
 if(mutation==='quantity')cart.items[0].quantity=3
 if(mutation==='schedule')cart.scheduledAt='2099-10-03T12:00:00'
 if(mutation==='hide')hide()
 if(mutation==='unload')unload()
 const expected=JSON.stringify(cart)
 waiting.resolve({rows:[{id:1,price:100,stock:1,active:1,options:[]}]});await load
 assert.equal(JSON.stringify(cart),expected);assert.equal(saved,0);page.close()
}
{
 const cart={storeId:1,items:[{id:1,price:100,quantity:1}]},first=deferred(),started=deferred();let calls=0
 const page=component('checkout',{cart,request:async url=>{
  if(url==='/stores/1/info')return {id:1,open_now:true}
  if(url.startsWith('/catalog/products?')){if(++calls===1){started.resolve();return first.promise}return {rows:[{id:1,price:200,stock:10,active:1,options:[]}]}}
  return []
 }})
 const old=page.bindings.loadCheckout();await started.promise
 await page.bindings.loadCheckout();assert.equal(cart.items[0].price,200)
 first.resolve({rows:[{id:1,price:100,stock:0,active:1,options:[]}]});await old
 assert.equal(cart.items[0].price,200);page.close()
}
console.log('PASS late checkout responses cannot overwrite another store, quantity, schedule, hidden/unloaded page or newer request')

// Exercise the real client login/request implementation with a mocked transport.
{
 const memory=new Map(),calls=[],callbacks=[],stateEnv={createIntentManager,reactive:vue.reactive,uni:{getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,v),removeStorageSync:k=>memory.delete(k),showToast(){},request(options){calls.push(options);callbacks.push(options)}}}
 const source=withoutImports(read('miniapp/src/lib/api.js')).replaceAll('import.meta.env.VITE_API_BASE',"''").replace(/\bexport /g,'')
 const api=evaluate(source+'\nreturn {state,login,request,logout,ensureLogin,cart}',stateEnv)
 const first=api.login(),second=api.login();assert.equal(first,second)
 callbacks.shift().success({statusCode:200,data:{code:200,data:{demoEnabled:true}}});await Promise.resolve()
 assert.equal(calls.length,2)
 callbacks.shift().success({statusCode:200,data:{code:200,data:{token:'first-token',memberId:7,demoCredential:'signed-demo-credential'}}});await first
 assert.equal(memory.get('food-demo-credential'),'signed-demo-credential')
 const expired=api.request('/me','GET',null,true)
 callbacks.shift().success({statusCode:401,data:{code:401,msg:'expired'}});await assert.rejects(expired)
 const restored=api.login();callbacks.shift().success({statusCode:200,data:{code:200,data:{demoEnabled:true}}});await Promise.resolve()
 assert.equal(calls.at(-1).data.demoCredential,'signed-demo-credential')
 callbacks.shift().success({statusCode:200,data:{code:200,data:{token:'restored-token',memberId:7,demoCredential:'renewed-credential'}}});await restored
 assert.equal(api.state.memberId,7)
 const stale=api.request('/me','GET',null,true);api.state.token='newer-token'
 callbacks.shift().success({statusCode:401,data:{code:401}});await assert.rejects(stale)
 assert.equal(api.state.token,'newer-token')
 const me=api.request('/me');callbacks.shift().success({statusCode:200,data:{code:200,data:{id:7,demoCredential:'upgraded-credential'}}});await me
 assert.equal(memory.get('food-demo-credential'),'upgraded-credential')
 console.log('PASS shared login attempt, persistent demo credential, expiry recovery, legacy credential upgrade and stale 401 isolation')
 api.cart.storeId=1;api.cart.items=[{id:1,quantity:2}];memory.set('food-selected-address',42);memory.set('food-checkout-intent-v1',{memberId:7})
 const lateMe=api.request('/me'),lateCallback=callbacks.shift()
 const signedOut=api.logout();assert.equal(api.state.token,'');assert.equal(api.state.memberId,0);assert.equal(api.state.signedOut,true)
 assert.equal(api.cart.items.length,0);assert.equal(memory.has('food-demo-credential'),false);assert.equal(memory.has('food-selected-address'),false);assert(memory.has('food-checkout-intent-v1'))
 const count=calls.length;await assert.rejects(api.ensureLogin(),/已退出登录/);assert.equal(calls.length,count)
 lateCallback.success({statusCode:200,data:{code:200,data:{id:7,demoCredential:'late-credential'}}});await lateMe;assert.equal(memory.has('food-demo-credential'),false)
 assert.equal(calls.at(-1).header['X-Food-Token'],'newer-token');callbacks.shift().success({statusCode:200,data:{code:200}});await signedOut
 const cancelled=api.login();callbacks.shift().success({statusCode:200,data:{code:200,data:{demoEnabled:true}}});await Promise.resolve()
 const loginResponse=callbacks.shift();await api.logout()
 loginResponse.success({statusCode:200,data:{code:200,data:{token:'cancelled-token',memberId:9,demoCredential:'cancelled-credential'}}});await assert.rejects(cancelled,/登录已取消/)
 assert.equal(api.state.token,'');assert.equal(memory.has('food-demo-credential'),false);assert.equal(calls.at(-1).header['X-Food-Token'],'cancelled-token')
 callbacks.shift().success({statusCode:200,data:{code:200}})
 const explicit=api.login();callbacks.shift().success({statusCode:200,data:{code:200,data:{demoEnabled:true}}});await Promise.resolve()
 assert.equal(calls.at(-1).data.demoCredential,undefined)
 callbacks.shift().success({statusCode:200,data:{code:200,data:{token:'explicit-token',memberId:10,demoCredential:'explicit-credential'}}});await explicit
 assert.equal(api.state.signedOut,false);assert.equal(memory.has('food-signed-out'),false)
 const offline=api.logout();callbacks.shift().fail();await offline;assert.equal(api.state.token,'');assert.equal(memory.get('food-signed-out'),true)
 const reloaded=evaluate(source+'\nreturn {state,ensureLogin}',stateEnv)
 const beforeReload=calls.length;assert.equal(reloaded.state.signedOut,true);await assert.rejects(reloaded.ensureLogin(),/已退出登录/);assert.equal(calls.length,beforeReload)
 console.log('PASS logout clears local identity/cart/address, preserves pending orders, blocks auto-login, ignores late responses and cancels in-flight login; explicit re-login and offline logout work')

}

{
 let allowed=false,exits=0,redirects=0,finishMe
 const state={token:'profile-token',memberId:7,demoCredential:'credential'},favorites={stores:[{id:1}],products:[{id:2}]}
 const page=component('profile',{BottomNav:{},state,favorites,login:async()=>{},logout:async()=>{exits++;state.token='';state.memberId=0;state.demoCredential=''},confirm:async()=>allowed,uni:{reLaunch(){redirects++}},request:()=>new Promise(r=>finishMe=r)})
 await page.bindings.signOut();assert.equal(exits,0);assert.equal(favorites.stores.length,1)
 const pending=page.bindings.load();allowed=true;await page.bindings.signOut()
 finishMe({nickname:'stale',points:100});await pending
 assert.equal(exits,1);assert.equal(redirects,1);assert.equal(favorites.stores.length,0);assert.equal(favorites.products.length,0);assert.deepEqual(page.bindings.me.value,{})
 page.close();console.log('PASS profile logout confirmation/cancel, cached favorites reset and stale profile response ignored')
}

// Login and startup must restore pending orders before a customer starts a new cart.
{
 const memory=new Map(),calls=[],toasts=[];let memberId=7,heldMe=null,holdMe=false,redirect=''
 const uni={getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,v),removeStorageSync:k=>memory.delete(k),showToast:r=>toasts.push(r.title),redirectTo:r=>redirect=r.url,request(options){
  const path=options.url.split('/food/app')[1];calls.push(path)
  if(path==='/me'&&holdMe){heldMe=options;return}
  const data=path==='/config'?{demoEnabled:true}:path==='/login'?{token:'token-'+memberId,memberId}:path==='/me'?{id:memberId}:path.startsWith('/orders/by-request/')?{found:true,order:{id:'original-order'}}:[]
  options.success({statusCode:200,data:{code:200,data}})
 }}
 const source=withoutImports(read('miniapp/src/lib/api.js')).replaceAll('import.meta.env.VITE_API_BASE',"''").replace(/\bexport /g,'')
 const api=evaluate(source+'\nreturn {state,intents,login,request,logout,ensureLogin,cart,clearCart}',{reactive:vue.reactive,createIntentManager,uni})
 api.intents.begin(7,{requestKey:'original-account-key'},'original-cart');api.intents.select(8)
 api.intents.begin(8,{requestKey:'other-account-key'},'other-cart')
 const home=component('home',{...api,memberState:api.state,BottomNav:{},location:vue.reactive({zone:'全部',point:null})})
 const orders=component('orders',{...api,BottomNav:{},statuses:{},createOrderFeed})
 await orders.bindings.signIn();await vue.nextTick()
 assert.equal(api.intents.read().body.requestKey,'original-account-key')
 assert.equal(home.bindings.pending.value,true);assert.equal(orders.bindings.pending.value,true)
 assert.equal(api.cart.storeId,null);assert.equal(api.cart.items.length,0)
 memberId=9;await api.login();await vue.nextTick()
 assert.equal(api.intents.read(),null);assert.equal(home.bindings.pending.value,false);assert.equal(orders.bindings.pending.value,false)
 // A late identity response must not reselect a different account's pending request.
 holdMe=true;const stale=api.request('/me');const staleCallback=heldMe
 memberId=8;await api.login();await vue.nextTick()
 staleCallback.success({statusCode:200,data:{code:200,data:{id:9}}});await stale
 assert.equal(api.state.memberId,8);assert.equal(api.intents.read().body.requestKey,'other-account-key')
 // Simulate startup with an existing token and an archived request from an older client.
 api.state.token='persisted-token-7';api.state.memberId=0;memberId=7;holdMe=false
 const app=compiler.parse(read('miniapp/src/App.vue')).descriptor.script.content
 evaluate(withoutImports(app).replace('export default','return'),api).onLaunch();await vue.nextTick()
 assert.equal(api.state.memberId,7);assert.equal(api.intents.read().body.requestKey,'original-account-key')
 assert.equal(home.bindings.pending.value,true);assert.equal(orders.bindings.pending.value,true)
 const recovery=evaluate(withoutImports(read('miniapp/src/lib/recovery.js')).replace(/\bexport /g,'')+'\nreturn {memberIdentity,recoverOrder,orderSession,assertOrderSession,openConfirmedOrder}',{state:api.state,request:api.request,cart:api.cart,clearCart:api.clearCart,ensureLogin:api.ensureLogin,accountIntents:api.intents,matchesIntentCart,uni})
 const checkout=component('checkout',{...api,...recovery})
 await checkout.bindings.loadCheckout()
 assert.equal(redirect,'/pages/order/index?id=original-order');assert.equal(calls.includes('/orders'),false)
 assert.equal(api.intents.read().orderId,'original-order')
 checkout.close();home.close();orders.close()
 console.log('PASS login/startup restore archived orders, visible home/orders banners update, stale identity is ignored and an empty cart can recover without resubmitting')

 await api.logout()
 for(const name of ['profile','help']){
  const before=calls.length,previous=toasts.length
  const page=component(name,{...api,BottomNav:{},favorites:{stores:[],products:[]},toast:message=>toasts.push(message)})
  if(name==='help')page.bindings.content.value='请帮忙查看订单'
  await (name==='profile'?page.bindings.checkin():page.bindings.submit())
  assert.equal(calls.length,before);assert.equal(toasts.length,previous+1)
  assert.match(toasts.at(-1),/已退出登录.*点击登录/)
  if(name==='help'){assert.equal(page.bindings.content.value,'请帮忙查看订单');assert.equal(page.bindings.busy.value,false)}
  page.close()
 }
 console.log('PASS signed-out check-in and feedback show login guidance, send no requests and preserve the feedback draft')
}
