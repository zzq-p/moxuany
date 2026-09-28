const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const docker=process.env.DOCKER_BIN||'D:/Docker/Desktop/resources/bin/docker.exe';
function sql(q){return execFileSync(docker,['exec','-i','moxuany-mysql','sh','-c','exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --default-character-set=utf8mb4 moxuany'],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
async function call(path,body,token){return (await fetch('http://127.0.0.1:8080/food/app'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Food-Token':token}:{})},body:body===undefined?undefined:JSON.stringify(body)})).json()}
(async()=>{
 const session=(await call('/login',{mode:'demo'})).data;assert(session?.memberId);const member=Number(session.memberId),token=session.token;
 const prefix='review-'+member+'-';
 try{
  // Dedicated terminal order fixtures, no stock reservations or real customer data.
  for(let i=0;i<47;i++){
   const type=i<21||i===46?'PICKUP':'DELIVERY',status=i<21?'COMPLETED':'CANCELLED',id=prefix+i;
   sql("INSERT INTO food_order(id,member_id,store_id,request_key,request_hash,type,status,pickup_code,created_at,expires_at) VALUES('"+id+"',"+member+",1,'"+id+"',REPEAT('0',64),'"+type+"','"+status+"','000000',DATE_ADD('2025-01-01',INTERVAL "+i+" MINUTE),NOW()); INSERT INTO food_order_item(order_id,product_id,name,image,price,quantity) VALUES('"+id+"',1,'Review fixture','/static/food/rice.jpg',100,1)");
  }
  const recent=(await call('/orders',undefined,token)).data;assert.equal(recent.length,20);assert(!recent.some(o=>o.status==='COMPLETED'));
  const first=(await call('/orders?type=PICKUP&status=COMPLETED',undefined,token)).data;
  const second=(await call('/orders?type=PICKUP&status=COMPLETED&page=2',undefined,token)).data;
  assert.equal(first.length,20);assert.equal(second.length,1);assert.equal(new Set([...first,...second].map(o=>o.id)).size,21);
  assert([...first,...second].every(o=>o.type==='PICKUP'&&o.status==='COMPLETED'&&o.items.length===1&&o.items[0].order_id===o.id));
  assert.equal((await call('/orders?type=PICKUP&status=CANCELLED',undefined,token)).data.length,1);
  for(const query of ['page=0','type=other','status=other'])assert.notEqual((await call('/orders?'+query,undefined,token)).code,200);
  assert.equal((await call('/orders?memberId='+member)).code,401);
  console.log('PASS server filters all 47 orders before pagination; old matches found; page boundaries, item grouping and invalid filters verified');
  const product=(await call('/stores/1')).data.products.find(p=>p.stock>0&&p.price>=1200);assert(product);
  const stock=Number(sql('SELECT stock FROM food_product WHERE id='+product.id));
  const coupon=(await call('/coupons',undefined,token)).data[0];
  const payload={storeId:1,type:'PICKUP',requestKey:crypto.randomUUID(),couponId:coupon.id,items:[{productId:product.id,quantity:1}],expectedTotal:0};
  const failed=await call('/orders',payload,token);assert.notEqual(failed.code,200);assert.match(failed.msg,/价格或配送费/);
  assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),stock);
  assert.equal(Number(sql("SELECT COUNT(*) FROM food_order WHERE member_id="+member+" AND request_key='"+payload.requestKey+"'")),0);
  assert((await call('/coupons',undefined,token)).data.some(c=>c.id===coupon.id));
  payload.expectedTotal=product.price-Math.min(product.price,coupon.amount);
  const success=await call('/orders',payload,token);assert.equal(success.code,200,JSON.stringify(success));assert.equal(success.data.total,payload.expectedTotal);
  assert.equal((await call('/orders',payload,token)).data.id,success.data.id);
  assert.notEqual((await call('/orders',{...payload,expectedTotal:payload.expectedTotal+1},token)).code,200);
  assert.equal((await call('/orders/'+success.data.id+'/cancel',{},token)).code,200);
  assert.equal(Number(sql('SELECT stock FROM food_product WHERE id='+product.id)),stock);
  assert.notEqual((await call('/orders',{...payload,requestKey:crypto.randomUUID(),items:[null]},token)).code,200);
  console.log('PASS changed amount rolls back order, stock and coupon; confirmed amount succeeds; retry is idempotent; null items rejected');
 }finally{
  const unpaid=sql("SELECT id FROM food_order WHERE member_id="+member+" AND status='UNPAID'");
  if(unpaid)for(const id of unpaid.split('\n'))assert.equal((await call('/orders/'+id.trim()+'/cancel',{},token)).code,200);
  sql('DELETE i FROM food_order_item i JOIN food_order o ON o.id=i.order_id WHERE o.member_id='+member+';DELETE FROM food_order WHERE member_id='+member+';DELETE FROM food_coupon WHERE member_id='+member+';DELETE FROM food_member WHERE id='+member);
  console.log('Dedicated review fixtures removed; original stock restored');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
