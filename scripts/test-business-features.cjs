// Local-only integration fixtures are removed in finally; no real payments or locations.
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const docker=process.env.DOCKER_BIN||'D:/Docker/Desktop/resources/bin/docker.exe';
function sql(q){return execFileSync(docker,['exec','-i','moxuany-mysql','sh','-c','exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --default-character-set=utf8mb4 moxuany'],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
async function call(path,body,token,admin=false){return (await fetch('http://127.0.0.1:8080'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{[admin?'Authorization':'X-Food-Token']:admin?'Bearer '+token:token}:{})},body:body===undefined?undefined:JSON.stringify(body)})).json()}
const prefix='feature-'+Date.now(),checks=[];function pass(s){checks.push(s);console.log('PASS '+s)}
const ok=r=>{assert.equal(r.code,200,JSON.stringify(r));return r.data};
(async()=>{
 const platform=await call('/login',{username:'admin',password:'admin123'});assert.equal(platform.code,200,JSON.stringify(platform));
 const merchant=await call('/login',{username:'merchant_demo',password:'Merchant123!'});assert.equal(merchant.code,200,JSON.stringify(merchant));
 const admin=(p,b)=>call('/food/admin'+p,b,platform.token,true),own=(p,b)=>call('/food/admin'+p,b,merchant.token,true);
 const member=ok(await call('/food/app/login',{mode:'demo'}));const app=(p,b)=>call('/food/app'+p,b,member.token);
 let store,product;
 try{
  const template={name:prefix,category:'test',zone:prefix,description:'integration fixture',image:'/static/food/rice.jpg',minutes:20,minimum:0,delivery_fee:0,active:1,latitude:0,longitude:0,open_time:'',close_time:'',delivery_radius:1000};
  ok(await admin('/stores/import',Array.from({length:23},(_,i)=>({...template,name:prefix+'-'+i,longitude:i===0?0:i/10}))));
  const first=ok(await admin('/catalog/stores?q='+prefix)),second=ok(await admin('/catalog/stores?q='+prefix+'&page=2'));assert.equal(first.total,23);assert.equal(first.rows.length,20);assert.equal(second.rows.length,3);assert.equal(new Set([...first.rows,...second.rows].map(s=>s.id)).size,23);
  store=[...first.rows,...second.rows].find(s=>s.name===prefix+'-0');assert(store);assert(store.open_now);
  assert.equal(ok(await own('/catalog/stores?q='+prefix)).total,0);assert.equal(ok(await own('/catalog/stores')).total,1);
  assert.equal((await call('/food/admin/catalog/stores')).code,401);pass('merchant/store pagination: 23 fixtures → 20 + 3, no duplicates, tenant isolation and authentication');
  const products=Array.from({length:25},(_,i)=>({store_id:store.id,name:prefix+'dish-'+i,category:i===24?'special':'regular',description:'',image:template.image,price:1500,stock:100,active:1}));products[24].name=prefix+'needle%_';
  ok(await admin('/products/import',products));
  const p1=ok(await app('/catalog/products?storeId='+store.id)),p2=ok(await app('/catalog/products?storeId='+store.id+'&page=2'));assert.equal(p1.total,25);assert.equal(p1.rows.length,20);assert.equal(p2.rows.length,5);assert.equal(new Set([...p1.rows,...p2.rows].map(p=>p.id)).size,25);product=p1.rows[0];
  assert.equal(ok(await app('/catalog/products?storeId='+store.id+'&category=special')).total,1);
  assert.equal(ok(await app('/catalog/products?storeId='+store.id+'&q='+encodeURIComponent('%_'))).total,1);
  assert.equal(ok(await app('/catalog/stores?q='+encodeURIComponent(prefix+'needle%_'))).rows[0].id,store.id);
  assert.equal(ok(await app('/catalog/products?storeId='+store.id+'&ids='+product.id)).rows[0].id,product.id);
  assert.equal(ok(await app('/catalog/products?storeId='+store.id+'&q=does-not-exist')).total,0);
  assert.notEqual((await own('/catalog/products?storeId='+store.id)).code,200);
  for(const q of ['page=0','pageSize=101','page=bad','sort=bad','sort=distance','sort=distance&latitude=91&longitude=0'])assert.notEqual((await app('/catalog/stores?'+q)).code,200);
  const nearby=ok(await app('/catalog/stores?q='+prefix+'&sort=distance&latitude=0&longitude=0&pageSize=2'));assert.equal(nearby.total,23);assert.equal(nearby.rows[0].id,store.id);assert.equal(nearby.rows[1].name,prefix+'-1');
  assert(ok(await app('/catalog/zones')).includes(prefix));assert.equal(ok(await app('/stores/'+store.id+'/info')).products,undefined);
  pass('product pagination/filtering, literal wildcard search, product-to-store search, global distance order, compact info and invalid-query checks');
  for(const bad of [{open_time:'09:00',close_time:''},{open_time:'25:00',close_time:'02:00'},{open_time:'09:00',close_time:'09:00'},{latitude:null,longitude:null},{delivery_radius:-1}])assert.notEqual((await admin('/stores',{...store,...bad})).code,200);
  const minute=Number(sql('SELECT HOUR(NOW())*60+MINUTE(NOW())')),time=m=>String(Math.floor((m%1440)/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  // A one-hour interval starting two hours from now must currently be closed, including midnight wrap.
  ok(await admin('/stores',{...store,open_time:time(minute+120),close_time:time(minute+180)}));assert.equal(ok(await app('/stores/'+store.id+'/info')).open_now,false);
  const body={storeId:store.id,type:'PICKUP',requestKey:crypto.randomUUID(),items:[{productId:product.id,quantity:1}]};
  assert.match((await app('/orders',body)).msg,/营业时间/);assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),100);
  // Midnight-spanning fixed hours checked against server-local (Asia/Shanghai) minute.
  ok(await admin('/stores',{...store,open_time:'22:00',close_time:'06:00'}));assert.equal(ok(await app('/stores/'+store.id+'/info')).open_now,minute>=1320||minute<360);
  ok(await admin('/stores',{...store,open_time:'',close_time:''}));pass('invalid hours/radius rejected; closed orders blocked without stock loss; overnight and all-day schedules');
  for(const [detail,latitude,longitude] of [['inside',0.001,0],['outside',0.02,0],['missing',null,null]])ok(await app('/addresses',{contact:'Fixture',phone:'13800000000',detail:prefix+detail,latitude,longitude}));
  const addresses=ok(await app('/addresses')),address=s=>addresses.find(a=>a.detail===prefix+s).id;
  assert.notEqual((await app('/addresses',{contact:'Fixture',phone:'13800000000',detail:prefix,latitude:0,longitude:null})).code,200);
  assert.match((await app('/orders',{...body,type:'DELIVERY',addressId:address('outside')})).msg,/配送范围/);
  assert.match((await app('/orders',{...body,type:'DELIVERY',addressId:address('missing')})).msg,/收货点/);
  assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),100);
  const delivery=ok(await app('/orders',{...body,type:'DELIVERY',addressId:address('inside')}));ok(await app('/orders/'+delivery.id+'/cancel',{}));
  const pickup=ok(await app('/orders',{...body,requestKey:crypto.randomUUID(),addressId:address('outside')}));ok(await app('/orders/'+pickup.id+'/cancel',{}));
  assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),100);
  pass('saved shipping coordinates: inside accepted, outside/missing rejected, pickup exempt; cancelled reservations fully restored');
  const pending=ok(await app('/orders',{...body,requestKey:crypto.randomUUID()}));
  assert(!ok(await admin('/order-alerts')).rows.some(r=>r.id===pending.id));
  ok(await app('/orders/'+pending.id+'/pay',{}));sql("UPDATE food_order SET paid_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE id='"+pending.id+"'");
  let alerts=ok(await admin('/order-alerts'));assert(alerts.rows.some(r=>r.id===pending.id));assert(alerts.overdue>=1);assert(!ok(await own('/order-alerts')).rows.some(r=>r.id===pending.id));
  assert.equal((await call('/food/admin/order-alerts')).code,401);
  ok(await admin('/orders/'+pending.id+'/status',{status:'PREPARING'}));assert(!ok(await admin('/order-alerts')).rows.some(r=>r.id===pending.id));
  // One fixture assigned to the merchant's store verifies the positive scoped case, without inventory or sales effects.
  const id=prefix+'alert';sql("INSERT INTO food_order(id,member_id,store_id,request_key,request_hash,type,status,pickup_code,paid_at,expires_at) VALUES('"+id+"',"+member.memberId+",1,'"+id+"',REPEAT('0',64),'PICKUP','PENDING','000000',DATE_SUB(NOW(),INTERVAL 6 MINUTE),NOW())");
  alerts=ok(await own('/order-alerts'));assert(alerts.rows.some(r=>r.id===id));assert(alerts.rows.every(r=>r.store_id===1));assert(alerts.overdue>=1);
  ok(await own('/orders/'+id+'/status',{status:'PREPARING'}));assert(!ok(await own('/order-alerts')).rows.some(r=>r.id===id));
  pass('alerts follow simulated payment → pending/overdue → accepted; scoped merchant positive/negative cases and anonymous access');
  fs.writeFileSync('docs/business-features-test-report.json',JSON.stringify({date:new Date().toISOString(),checks,scope:'Local integration with isolated fixtures; synthetic WGS84 coordinates; not a production capacity guarantee.'},null,2));
 }finally{
  // All reservations belong to fixture products which are about to be removed.
  const mid=Number(member.memberId);sql('DELETE i FROM food_order_item i JOIN food_order o ON o.id=i.order_id WHERE o.member_id='+mid+';DELETE FROM food_order WHERE member_id='+mid+';DELETE FROM food_address WHERE member_id='+mid+';DELETE FROM food_coupon WHERE member_id='+mid+';DELETE FROM food_member WHERE id='+mid+";DELETE p FROM food_product p JOIN food_store s ON s.id=p.store_id WHERE s.zone='"+prefix+"';DELETE FROM food_store WHERE zone='"+prefix+"'");
  console.log('Fixture stores, products, addresses, orders and member removed');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
