import assert from 'node:assert/strict'
import {createOrderFeed} from '../miniapp/src/lib/order-feed.mjs'
import {reconcileCart} from '../miniapp/src/lib/checkout.mjs'
const state={rows:[],page:1,hasMore:false,loading:false,error:''}
const requests=[]
const feed=createOrderFeed(state,params=>new Promise((resolve,reject)=>requests.push({params,resolve,reject})))
const old=feed.reset({type:'DELIVERY',status:''})
const latest=feed.reset({type:'PICKUP',status:'COMPLETED'})
requests[1].resolve([{id:'current'}]);await latest
requests[0].resolve([{id:'outdated'}]);await old
assert.equal(state.rows[0].id,'current');assert.equal(state.loading,false)
let current=feed.reset({type:'DELIVERY',status:''})
requests[2].resolve(Array.from({length:20},(_,id)=>({id})));await current
current=feed.more();await feed.more();assert.equal(requests.length,4)
assert.equal(requests[3].params.page,2)
requests[3].resolve([{id:19},{id:20}]);await current
assert.equal(state.rows.length,21);assert.equal(state.hasMore,false);assert.equal(state.page,2)
current=feed.reset({type:'PICKUP',status:''});feed.cancel();requests[4].resolve([{id:'hidden'}]);await current
assert.equal(state.rows.length,0);assert.equal(state.loading,false)
current=feed.reset({type:'DELIVERY',status:'PENDING'});requests[5].reject(Error('offline'));await current
assert.equal(state.error,'offline');assert.equal(state.loading,false)
current=feed.reset({type:'DELIVERY',status:'PENDING'});requests[6].resolve([]);await current
assert.equal(state.error,'');assert.equal(state.hasMore,false)
console.log('PASS order filters ignore old responses; duplicate load-more guarded; deduplication; hide cancels; retry recovers')
const refreshed=reconcileCart([{id:1,price:100,quantity:3},{id:2,price:200,quantity:1},{id:3,price:300,quantity:1}], [{id:1,price:150,stock:2},{id:2,price:200,stock:0}])
assert.equal(refreshed.changed,true);assert.deepEqual(refreshed.items.map(({id,price,stock,quantity})=>({id,price,stock,quantity})),[{id:1,price:150,stock:2,quantity:2}])
const unchanged=reconcileCart([{id:1,price:150,quantity:1}],[{id:1,price:150,stock:2}]);assert.equal(unchanged.changed,false)
console.log('PASS checkout refreshes current prices, caps quantity by stock, removes unavailable items')
