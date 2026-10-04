import {state,request} from './api'

// Bind every step of a member operation to the session that started it.
export function captureSession(){
 const token=state.token,revision=state.authRevision
 const current=()=>!!token&&!state.signedOut&&token===state.token&&revision===state.authRevision
 const assertCurrent=()=>{if(!current())throw Error('登录状态已变化，请重新操作')}
 return {token,current,assertCurrent,async request(path,method='GET',data,quiet=true){
  assertCurrent()
  const result=await request(path,method,data,quiet,token)
  assertCurrent()
  return result
 }}
}
