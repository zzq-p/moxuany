import {cart,saveCart,confirm,toast,go} from './api'
import {reconcileCart} from './checkout.mjs'
import {captureSession} from './session'
import {cartSignature} from './order-intent.mjs'
export async function reorder(id){
 const session=captureSession(),signature=cartSignature(cart)
 const current=()=>{session.assertCurrent();if(cartSignature(cart)!==signature)throw Error('购物车已变化，请重新确认')}
 const data=await session.request('/orders/'+id+'/reorder');current()
 const result=reconcileCart(data.items,data.products)
 if(!result.items.length){toast('原订单菜品暂不可售，请重新选购');return}
 const count=result.items.reduce((n,p)=>n+p.quantity,0),total=result.items.reduce((n,p)=>n+p.quantity*p.price,0)
 if(!await confirm('已按当前价格、规格和库存整理 '+count+' 份菜品，合计 ¥'+(total/100).toFixed(2)+'（不含配送和优惠）。'+(result.changed?'部分菜品价格、规格或数量已变化。':'')+(cart.items.length?'将替换当前购物车。':'')+'是否加入购物车？'))return
 current()
 cart.storeId=data.storeId;cart.items=result.items;cart.scheduledAt='';saveCart();go('checkout/index')
}
