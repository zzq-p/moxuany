import {createIntentManager,cartSignature} from './order-intent.mjs'
import {state,request,cart,clearCart} from './api'
export const intents=createIntentManager({get:k=>uni.getStorageSync(k),set:(k,v)=>uni.setStorageSync(k,v),remove:k=>uni.removeStorageSync(k)})
export async function memberIdentity(){const me=await request('/me');state.memberId=me.id;return me.id}
export function openConfirmedOrder(order){const value=intents.resolved(state.memberId,order);if(value&&cartSignature(cart)===value.signature)clearCart();uni.redirectTo({url:'/pages/order/index?id='+order.id})}
export async function recoverOrder(retry=false){const value=intents.own(state.memberId);if(!value)return false;if(value.orderId){openConfirmedOrder({id:value.orderId});return true}const data=await request('/orders/by-request/'+encodeURIComponent(value.body.requestKey),'GET',null,true);if(data.found){openConfirmedOrder(data.order);return true}if(!retry)return false;try{const order=await request('/orders','POST',value.body,true);openConfirmedOrder(order);return true}catch(e){if(e.code===601)intents.rejected(state.memberId,value.body.requestKey);throw e}}
