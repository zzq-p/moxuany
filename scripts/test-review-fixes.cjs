// Local demo only: isolated fixtures, real API requests and deterministic MySQL lock contention.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {execFileSync,spawn}=require('node:child_process');
const docker=process.env.DOCKER_BIN||'D:/Docker/Desktop/resources/bin/docker.exe';
const mysql=['exec','-i','moxuany-mysql','sh','-c','exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --unbuffered --skip-column-names --default-character-set=utf8mb4 moxuany'];
const sql=q=>execFileSync(docker,mysql,{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const redis=(...args)=>execFileSync(docker,['exec','moxuany-redis','redis-cli','-n','1',...args],{encoding:'utf8'}).trim();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ok=r=>{assert.equal(r.code,200,JSON.stringify(r));return r.data};
async function call(path,body,token,admin=false){return(await fetch('http://127.0.0.1:8080'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{[admin?'Authorization':'X-Food-Token']:admin?'Bearer '+token:token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)})).json()}
async function waitFor(check,label){const end=Date.now()+10000;while(Date.now()<end){if(check())return;await pause(50)}throw Error('Timed out: '+label)}
const prefix='review'+Date.now(),checks=[],pass=s=>{checks.push(s);console.log('PASS '+s)};
(async()=>{
 assert.equal(ok(await call('/food/app/config')).demoEnabled,true);
 const member=ok(await call('/food/app/login',{mode:'demo'})),other=ok(await call('/food/app/login',{mode:'demo'}));
 let store,product,blocker;const sessions=[member.token,other.token];
 try{
  assert(member.demoCredential);
  const before=sql('SELECT COUNT(*) FROM food_coupon WHERE member_id='+member.memberId);
  redis('DEL','food:session:'+member.token);
  assert.equal((await call('/food/app/me',undefined,member.token)).code,401);
  const resumed=ok(await call('/food/app/login',{mode:'demo',demoCredential:member.demoCredential}));sessions.push(resumed.token);
  assert.equal(resumed.memberId,member.memberId);assert.equal(sql('SELECT COUNT(*) FROM food_coupon WHERE member_id='+member.memberId),before);
  const me=ok(await call('/food/app/me',undefined,resumed.token));assert(me.demoCredential);assert.equal(me.id,member.memberId);
  for(const credential of [member.demoCredential.replace(/^v2\.\d+/, 'v2.'+other.memberId),member.demoCredential.slice(0,-1)+(member.demoCredential.endsWith('0')?'1':'0'),'invalid'])assert.notEqual((await call('/food/app/login',{mode:'demo',demoCredential:credential})).code,200);
  const secret=process.env.TOKEN_SECRET||fs.readFileSync('.env','utf8').split(/\r?\n/).find(line=>line.startsWith('TOKEN_SECRET=')).slice('TOKEN_SECRET='.length);
  const expiredParts=member.demoCredential.split('.');expiredParts[3]=String(Math.floor(Date.now()/1000)-1);
  const expiredValue=expiredParts.slice(0,-1).join('.');
  const expired=expiredValue+'.'+crypto.createHmac('sha256',secret).update('food-demo:'+expiredValue).digest('hex');
  assert.notEqual((await call('/food/app/login',{mode:'demo',demoCredential:expired})).code,200);
  const legacyValue=member.memberId+'.'+'a'.repeat(32),legacy=legacyValue+'.'+crypto.createHmac('sha256',secret).update('food-demo:'+legacyValue).digest('hex');
  assert.notEqual((await call('/food/app/login',{mode:'demo',demoCredential:legacy})).code,200);
  assert(Number(member.demoCredential.split('.')[3])>Date.now()/1000+29*86400);
  pass('signed expired and legacy unrevocable recovery credentials are rejected; new credentials expire within 30 days');
  member.token=resumed.token;
  pass('expired Redis session restores original demo account; no extra welcome coupon; tampered/member-swapped credentials rejected');
  const login=await call('/login',{username:'admin',password:'admin123'});ok(login);
  const admin=(p,b)=>call('/food/admin'+p,b,login.token,true),app=(p,b,t=member.token)=>call('/food/app'+p,b,t);
  ok(await admin('/stores',{name:prefix,category:'review',zone:prefix,description:'isolated review fixture',image:'/static/food/rice.jpg',minutes:20,minimum:0,delivery_fee:0,active:1,latitude:0,longitude:0,delivery_radius:0,open_time:'',close_time:'',business_periods:'',reservation_enabled:0}));
  store=ok(await admin('/catalog/stores?q='+prefix)).rows[0];
  ok(await admin('/products',{store_id:store.id,name:prefix,category:'review',description:'',image:store.image,price:1000,stock:100,active:1}));
  product=ok(await admin('/catalog/products?storeId='+store.id)).rows[0];
  const body={storeId:store.id,type:'PICKUP',requestKey:crypto.randomUUID(),items:[{productId:product.id,quantity:1}],expectedTotal:1000};
  // Run the actual client recovery code against HTTP while switching accounts at
  // controlled response boundaries. Both isolated users are removed in finally.
  const intentModule=await import('../miniapp/src/lib/order-intent.mjs');
  const recoverySource=fs.readFileSync('miniapp/src/lib/recovery.js','utf8').replace(/^import .*$/gm,'').replace(/\bexport /g,'');
  for(const boundary of ['lookup','post']){
   let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
   const memory=new Map(),state={token:member.token,memberId:member.memberId,authRevision:0,signedOut:false};let posted=0,redirected=0,cleared=0;
   const requestKey=crypto.randomUUID();
   const env={...intentModule,accountIntents:intentModule.createIntentManager({get:k=>memory.get(k),set:(k,v)=>memory.set(k,v),remove:k=>memory.delete(k)}),state,cart:{storeId:store.id,items:[]},ensureLogin:async()=>{},clearCart(){cleared++},uni:{getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,v),removeStorageSync:k=>memory.delete(k),redirectTo(){redirected++}},request:async(path,method,data,quiet,token)=>{
    if(method==='POST')posted++;
    const result=ok(await app(path,method==='GET'?undefined:data,token));
    if((boundary==='lookup'&&path.startsWith('/orders/by-request/'))||(boundary==='post'&&method==='POST')){entered();await waiting}
    return result;
   }};
   const recovery=new Function(...Object.keys(env),recoverySource+'\nreturn {intents,recoverOrder}')( ...Object.values(env));
   recovery.intents.begin(member.memberId,{...body,requestKey},'original-cart');
   const pending=recovery.recoverOrder(true),rejected=assert.rejects(pending,/登录状态已变化/);
   await started;state.authRevision++;state.token=other.token;state.memberId=other.memberId;recovery.intents.select(other.memberId);release();await rejected;
   assert.equal(posted,boundary==='lookup'?0:1);assert.equal(redirected,0);assert.equal(cleared,0);
   assert.equal(ok(await app('/orders/by-request/'+requestKey,undefined,other.token)).found,false);
   const original=ok(await app('/orders/by-request/'+requestKey));assert.equal(original.found,boundary==='post');
   recovery.intents.select(member.memberId);assert.equal(recovery.intents.read().body.requestKey,requestKey);assert.equal(recovery.intents.read().orderId,undefined);
   if(original.found)ok(await app('/orders/'+original.order.id+'/cancel',{}));
   assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),100);
  }
  pass('real frontend recovery with account switches during lookup and POST never creates an order for the new account or clears its cart; original pending request remains recoverable');
  const order=ok(await app('/orders',body));redis('DEL','food:session:'+member.token);
  const again=ok(await call('/food/app/login',{mode:'demo',demoCredential:me.demoCredential}));sessions.push(again.token);member.token=again.token;
  const recovered=ok(await app('/orders/by-request/'+body.requestKey));assert(recovered.found);assert.equal(recovered.order.id,order.id);
  assert.equal(ok(await app('/orders',body)).id,order.id);assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),99);
  assert.equal(ok(await app('/orders/by-request/'+body.requestKey,undefined,other.token)).found,false);
  assert.notEqual((await app('/orders/'+order.id,undefined,other.token)).code,200);
  ok(await app('/orders/'+order.id+'/cancel',{}));assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),100);
  pass('original request recovered and retried after session expiry without duplicate order or stock deduction; foreign account isolated');
  const distance=ok(await app('/catalog/stores?q='+prefix+'&sort=distance&latitude=0&longitude=0'));assert.equal(distance.rows[0].id,store.id);
  assert.equal((await app('/orders',{...body,requestKey:crypto.randomUUID(),expectedTotal:1})).code,601);
  assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),100);
  pass('distance catalog works and stale checkout total rolls back stock');
  // Hold the shared member row. Completion must acquire product first, then wait here.
  // An old implementation waits on member first, allowing the refund to invert locks.
  const completeId=prefix+'complete',refundOrder=prefix+'refund',refundId=prefix+'rf';
  sql("INSERT INTO food_order(id,member_id,store_id,request_key,request_hash,type,status,pickup_code,subtotal,total,expires_at,paid_at,completed_at,refund_status,refund_id) VALUES('"+completeId+"',"+member.memberId+","+store.id+",'"+completeId+"',REPEAT('0',64),'DELIVERY','DELIVERING','000000',1000,1000,DATE_ADD(NOW(),INTERVAL 1 DAY),NOW(),NULL,'NONE',NULL),('"+refundOrder+"',"+member.memberId+","+store.id+",'"+refundOrder+"',REPEAT('0',64),'DELIVERY','COMPLETED','000000',1000,1000,DATE_ADD(NOW(),INTERVAL 1 DAY),NOW(),NOW(),'REQUESTED','"+refundId+"'); INSERT INTO food_order_item(order_id,product_id,name,image,price,quantity) VALUES('"+completeId+"',"+product.id+",'fixture','',1000,1),('"+refundOrder+"',"+product.id+",'fixture','',1000,1); INSERT INTO food_refund(id,order_id,member_id,reason,amount,kind) VALUES('"+refundId+"','"+refundOrder+"',"+member.memberId+",'review fixture',1000,'FULL'); INSERT INTO food_refund_item(refund_id,item_id,quantity,amount) SELECT '"+refundId+"',id,1,1000 FROM food_order_item WHERE order_id='"+refundOrder+"'; UPDATE food_member SET points=10 WHERE id="+member.memberId+"; UPDATE food_product SET sales=1 WHERE id="+product.id+"; UPDATE food_store SET sales=1 WHERE id="+store.id);
  blocker=spawn(docker,mysql,{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';blocker.stdout.on('data',b=>{output+=b});blocker.stderr.resume();
  blocker.stdin.write('START TRANSACTION; SELECT id FROM food_member WHERE id='+member.memberId+" FOR UPDATE; SELECT 'LOCKED';\n");
  await waitFor(()=>output.includes('LOCKED'),'member lock acquired');
  const completion=app('/orders/'+completeId+'/complete',{});
  const waits=table=>Number(sql("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA='moxuany' AND l.OBJECT_NAME='"+table+"'"));
  await waitFor(()=>waits('food_member')>=1,'completion waiting for shared member');
  const refund=admin('/orders/'+refundOrder+'/refund',{refundId,decision:'APPROVE',reply:'review approved'});
  try{await waitFor(()=>waits('food_product')>=1,'refund waiting for product in matching lock order')}finally{blocker.stdin.end('COMMIT;\n')}
  (await Promise.all([completion,refund])).forEach(ok);
  assert.equal(sql("SELECT status FROM food_order WHERE id='"+completeId+"'"),'COMPLETED');assert.equal(sql("SELECT status FROM food_order WHERE id='"+refundOrder+"'"),'REFUNDED');
  assert.equal(Number(sql('SELECT points FROM food_member WHERE id='+member.memberId)),10);
  assert.equal(Number(sql('SELECT sales FROM food_product WHERE id='+product.id)),1);assert.equal(Number(sql('SELECT sales FROM food_store WHERE id='+store.id)),1);
  pass('deterministic concurrent completion/refund share product→member→store lock order; both succeed and points/sales reconcile');
  const pickup=ok(await app('/orders',{...body,requestKey:crypto.randomUUID()}));
  assert.match(pickup.pickup_code,/^[0-9]{6}$/);
  const absent=row=>assert.equal(Object.hasOwn(row,'pickup_code'),false);
  absent(ok(await admin('/orders/'+pickup.id)));
  ok(await admin('/orders')).rows.forEach(absent);
  ok(await app('/orders/'+pickup.id+'/pay',{}));
  const queue=ok(await admin('/kitchen?storeId='+store.id));assert(queue.some(o=>o.id===pickup.id));queue.forEach(absent);
  ok(await admin('/orders/'+pickup.id+'/status',{status:'PREPARING'}));
  ok(await admin('/orders/'+pickup.id+'/status',{status:'READY'}));
  assert.notEqual((await admin('/orders/'+pickup.id+'/verify-pickup',{code:pickup.pickup_code==='000000'?'999999':'000000'})).code,200);
  ok(await admin('/orders/'+pickup.id+'/verify-pickup',{code:pickup.pickup_code}));
  assert.equal(ok(await app('/orders/'+pickup.id)).status,'COMPLETED');
  pass('merchant list/detail/kitchen omit pickup code; customer keeps code and correct-code verification still works');
  const credentialBeforeLogout=ok(await app('/me')).demoCredential;
  const [lateMe]=await Promise.all([app('/me'),app('/logout',{})]);
  for(const credential of [credentialBeforeLogout,member.demoCredential,me.demoCredential,...(lateMe.code===200?[lateMe.data.demoCredential]:[])]){
   assert.notEqual((await call('/food/app/login',{mode:'demo',demoCredential:credential})).code,200);
  }
  assert.equal((await app('/me')).code,401);
  assert.equal((await app('/orders')).code,401);
  ok(await app('/logout',{}));
  ok(await call('/food/app/logout',{}));
  assert.equal(ok(await app('/me',undefined,other.token)).id,other.memberId);
  const otherCredential=ok(await app('/me',undefined,other.token)).demoCredential;
  redis('DEL','food:session:'+other.token);
  ok(await call('/food/app/logout',{demoCredential:otherCredential}));
  ok(await call('/food/app/logout',{demoCredential:otherCredential}));
  assert.notEqual((await call('/food/app/login',{mode:'demo',demoCredential:otherCredential})).code,200);
  pass('logout revokes current session and all older recovery credentials, including concurrent me issuance and logout after session expiry; repeated logout is safe');
  fs.writeFileSync('docs/review-fixes-test-report.json',JSON.stringify({date:new Date().toISOString(),checks,scope:'Local demo API, isolated fixtures; deterministic database lock contention, no real payments.'},null,2)+'\n');
 }finally{
  if(blocker&&!blocker.stdin.destroyed)blocker.stdin.end('ROLLBACK;\n');
  const mids=[member.memberId,other.memberId].join(',');
  sql('DELETE x FROM food_refund_item x JOIN food_refund r ON r.id=x.refund_id WHERE r.member_id IN ('+mids+'); DELETE FROM food_message WHERE member_id IN ('+mids+'); DELETE x FROM food_order_event x JOIN food_order o ON o.id=x.order_id WHERE o.member_id IN ('+mids+'); DELETE FROM food_refund WHERE member_id IN ('+mids+'); DELETE i FROM food_order_item i JOIN food_order o ON o.id=i.order_id WHERE o.member_id IN ('+mids+'); DELETE FROM food_order WHERE member_id IN ('+mids+'); DELETE FROM food_coupon WHERE member_id IN ('+mids+'); DELETE FROM food_member WHERE id IN ('+mids+');'+(store?'DELETE FROM food_staff_audit WHERE store_id='+store.id+'; DELETE FROM food_product WHERE store_id='+store.id+'; DELETE FROM food_store WHERE id='+store.id+';':''));
  for(const token of sessions)redis('DEL','food:session:'+token);
  console.log('Review fixtures removed');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
