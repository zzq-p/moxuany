import assert from 'node:assert/strict'
import { coordinates, distanceMeters, distanceText, compareDistance } from '../miniapp/src/lib/geo.mjs'
import { initialLocation, createLocationController } from '../miniapp/src/lib/location-controller.mjs'

const origin = {latitude:0,longitude:0}
assert.equal(distanceMeters(origin, origin),0)
assert.ok(Math.abs(distanceMeters(origin,{latitude:0,longitude:1})-111195)<1)
assert.ok(distanceMeters({latitude:0,longitude:179.9},{latitude:0,longitude:-179.9})<22300)
for(const bad of [null,undefined,'',false,'abc',Infinity,NaN,91])assert.equal(coordinates(bad,0),null)
assert.equal(coordinates(0,181),null)
assert.deepEqual(coordinates('0','0'),origin)
assert.equal(distanceText(null,{distance:200}),'定位后查看距离')
assert.equal(distanceText(origin,{distance:200}),'距离待完善')
assert.equal(distanceText(origin,origin),'直线 0m')
const stores=[{id:1,latitude:null,longitude:null,rating:5},{id:2,latitude:0,longitude:1,rating:4},{id:3,...origin,rating:4}]
assert.deepEqual(stores.sort((a,b)=>compareDistance(origin,a,b)).map(s=>s.id),[3,2,1])
console.log('PASS coordinate validation, known distances, dateline, unknown distances, sorting')

let now=1000
const state=initialLocation()
let controller=createLocationController(state,async()=>origin,async()=>({resolved:false}),()=>now)
await controller.locate();assert.deepEqual(state.point,origin);assert.equal(state.label,'当前位置');assert.equal(state.busy,false)
now+=600000;controller.expire();assert.equal(state.point,null);assert.equal(state.label,'选择位置')
controller=createLocationController(state,async()=>{throw {errMsg:'getLocation:fail auth deny'}},async()=>assert.fail('must not geocode'))
await controller.locate();assert.match(state.error,/权限/);assert.equal(state.point,null)
controller=createLocationController(state,async()=>{throw Error('timeout')},async()=>assert.fail('must not geocode'))
await controller.locate();assert.match(state.error,/超时/);assert.equal(state.busy,false)
controller=createLocationController(state,async()=>origin,async()=>{throw Error('network')})
await controller.locate();assert.deepEqual(state.point,origin);assert.equal(state.label,'当前位置')
console.log('PASS no key, expiry, denied permission, timeout, reverse-geocoder failure')

let finish
controller=createLocationController(state,()=>new Promise(r=>{finish=r}),async()=>({resolved:true,label:'测试城市'}))
let pending=controller.locate();controller.manual('商业街');finish(origin);await pending
assert.equal(state.point,null);assert.equal(state.zone,'商业街');assert.equal(state.label,'手动选择')
controller=createLocationController(state,async()=>origin,()=>new Promise(r=>{finish=r}))
pending=controller.locate();await Promise.resolve();controller.manual('二食堂');finish({resolved:true,label:'旧请求'});await pending
assert.equal(state.label,'手动选择');assert.equal(state.zone,'二食堂');assert.equal(state.point,null)
controller=createLocationController(state,async()=>origin,async()=>({resolved:true,label:'测试城市 · 测试区'}))
await controller.locate();assert.equal(state.label,'测试城市 · 测试区');assert.equal(state.zone,'全部')
console.log('PASS late GPS/geocode results cannot override manual selection; resolved city is displayed')
