import assert from 'node:assert/strict'
import {configureProduct} from '../miniapp/src/lib/options.mjs'
import {reconcileCart} from '../miniapp/src/lib/checkout.mjs'
import {createIntentManager,cartSignature} from '../miniapp/src/lib/order-intent.mjs'
import {fromGcj02} from '../miniapp/src/lib/map-point.mjs'
const product={id:1,price:1000,stock:6,options:[{id:11,kind:'SPEC',name:'大份',price:1500,stock:3},{id:12,kind:'SPEC',name:'小份',price:1000,stock:6},{id:13,kind:'ADDON',name:'加蛋',price:200,stock:2}]}
assert.throws(()=>configureProduct(product),/规格/);assert.throws(()=>configureProduct(product,11,[99]));assert.throws(()=>configureProduct(product,11,[13,13]));
const large=configureProduct(product,11,[13]);assert.equal(large.price,1700);assert.equal(large.stock,2)
const small=configureProduct(product,12,[13]);const fixed=reconcileCart([{...large,quantity:2},{...small,quantity:2}],[product]);assert.equal(fixed.changed,true);assert.equal(fixed.items.length,1);assert.equal(fixed.items[0].quantity,2)
assert.equal(reconcileCart([{...large,quantity:1}],[{...product,options:product.options.filter(o=>o.id!==11)}]).items.length,0)
console.log('PASS option required/ownership, independent price and stock, shared addon stock, unavailable selection removed')
const mem=new Map(),storage={get:k=>mem.get(k),set:(k,v)=>mem.set(k,structuredClone(v)),remove:k=>mem.delete(k)};let intent=createIntentManager(storage)
const cart={storeId:1,items:[{...large,quantity:1}]},body={requestKey:'unique-request-key-001',items:[{productId:1,specId:11,addonIds:[13],quantity:1}]};const signature=cartSignature(cart)
intent.begin(1,body,signature);body.items[0].quantity=5;assert.equal(intent.read().body.items[0].quantity,1);assert.throws(()=>intent.begin(1,body,signature));
intent=createIntentManager(storage);assert.equal(intent.own(1).body.requestKey,'unique-request-key-001');assert.throws(()=>intent.own(2));assert.throws(()=>intent.rejected(2,body.requestKey));assert(intent.read());intent.rejected(1,'unrelated');assert(intent.read())
intent.resolved(1,{id:'order-001'});assert.equal(intent.read().orderId,'order-001');assert.notEqual(cartSignature({...cart,items:[{...large,quantity:2}]}),intent.read().signature);intent.settled(1,'other');assert(intent.read());intent.settled(1,'order-001');assert.equal(intent.read(),null)
assert.throws(()=>createIntentManager({...storage,set:()=>{throw Error('storage full')}}).begin(1,body,signature),/storage full/)
console.log('PASS persisted immutable checkout survives reload, same key retained, account isolation, unrelated cart preserved, storage failure blocks submit')
const p=fromGcj02({latitude:39.910226,longitude:116.403714});assert(Math.abs(p.latitude-39.908823)<0.0001);assert(Math.abs(p.longitude-116.39747)<0.0001);assert.throws(()=>fromGcj02({latitude:91,longitude:0}));console.log('PASS map GCJ02 → WGS84 reference point and coordinate bounds')
