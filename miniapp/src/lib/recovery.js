import {matchesIntentCart} from './order-intent.mjs'
import {state,request,cart,clearCart,ensureLogin,intents as accountIntents} from './api'
export const intents=accountIntents
const sessionChanged=()=>Error('登录状态已变化，请重新确认订单')
export function orderSession(){return {token:state.token,memberId:state.memberId,revision:state.authRevision}}
export function assertOrderSession(session){if(!session.token||state.signedOut||session.token!==state.token||session.memberId!==state.memberId||session.revision!==state.authRevision)throw sessionChanged()}
export async function memberIdentity(){
 const revision=state.authRevision
 const unchanged=()=>{if(state.signedOut||revision!==state.authRevision)throw sessionChanged()}
 state.memberId=0
 await ensureLogin()
 unchanged();let token=state.token,me
 try{me=await request('/me','GET',null,true,token)}catch(e){
  if(e.code!==401)throw e
  unchanged();if(state.token&&state.token!==token)throw sessionChanged()
  // request clears an expired token. Reauthenticate once, then verify the account.
  await ensureLogin()
  unchanged();token=state.token
  me=await request('/me','GET',null,true,token)
 }
 unchanged();if(!token||token!==state.token)throw sessionChanged()
 state.memberId=me.id;intents.select(me.id);return me.id
}
export function openConfirmedOrder(order,session=orderSession()){assertOrderSession(session);const value=intents.resolved(session.memberId,order);if(value&&matchesIntentCart(cart,value))clearCart();uni.redirectTo({url:'/pages/order/index?id='+order.id})}
export async function recoverOrder(retry=false){
 const session=orderSession();assertOrderSession(session)
 const value=intents.own(session.memberId);if(!value)return false
 const current=()=>{assertOrderSession(session);if(intents.read()?.body.requestKey!==value.body.requestKey)throw Error('待确认订单已变化，请刷新后重试')}
 if(value.orderId){openConfirmedOrder({id:value.orderId},session);return true}
 const data=await request('/orders/by-request/'+encodeURIComponent(value.body.requestKey),'GET',null,true,session.token)
 current()
 if(data.found){openConfirmedOrder(data.order,session);return true}
 if(!retry)return false
 try{const order=await request('/orders','POST',value.body,true,session.token);current();openConfirmedOrder(order,session);return true}
 catch(e){current();if(e.code===601)intents.rejected(session.memberId,value.body.requestKey);throw e}
}
