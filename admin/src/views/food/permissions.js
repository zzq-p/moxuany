export function allowed(scope,store,capability){
 if(scope?.platform)return true
 return (scope?.stores||[]).some(s=>Number(s.store_id)===Number(store)&&(s.staff_role==='MANAGER'||capability==='READ'||s.staff_role==='CLERK'&&['ORDER','PICKUP','REPLY'].includes(capability)||s.staff_role==='KITCHEN'&&capability==='COOK'))
}
