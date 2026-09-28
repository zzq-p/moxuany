const assert=require('node:assert/strict');
const base='http://127.0.0.1:8080';
async function call(path,body,token){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return response.json()}
(async()=>{
 assert.equal((await call('/food/app/config')).data.city,undefined);
 for(const body of [{},{latitude:null,longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:'NaN',longitude:0},{latitude:false,longitude:0}])assert.notEqual((await call('/food/app/location/reverse',body)).code,200);
 const reverse=await call('/food/app/location/reverse',{latitude:0,longitude:0});assert.equal(reverse.code,200);assert.equal(typeof reverse.data.resolved,'boolean');if(!reverse.data.resolved)assert.equal(reverse.data.label,'当前位置');
 console.log('PASS no hardcoded city; reverse endpoint rejects invalid coordinates and handles missing key');
 const admin=(await call('/login',{username:'admin',password:'admin123'})).token;
 const merchant=(await call('/login',{username:'merchant_demo',password:'Merchant123!'})).token;
 assert(admin&&merchant,'local demo accounts must exist');
 const own=(await call('/food/admin/stores',undefined,merchant)).data[0];
 const other=(await call('/food/admin/stores',undefined,admin)).data.find(s=>s.id!==own.id);
 assert.notEqual((await call('/food/admin/stores',{...other,latitude:0,longitude:0},merchant)).code,200);
 for(const coords of [{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:0,longitude:null},{latitude:'NaN',longitude:0}])assert.notEqual((await call('/food/admin/stores',{...own,...coords},merchant)).code,200);
 try {
  assert.equal((await call('/food/admin/stores',{...own,latitude:0,longitude:0},merchant)).code,200);
  const detail=(await call('/food/app/stores/'+own.id)).data;assert.equal(Number(detail.latitude),0);assert.equal(Number(detail.longitude),0);
  const list=(await call('/food/app/stores')).data.find(s=>s.id===own.id);assert.equal(Number(list.latitude),0);
  assert.equal((await call('/food/admin/stores',{...own,latitude:null,longitude:null},merchant)).code,200);
  const cleared=(await call('/food/app/stores/'+own.id)).data;assert.equal(cleared.latitude,null);assert.equal(cleared.longitude,null);
 } finally {assert.equal((await call('/food/admin/stores',own,merchant)).code,200)}
 const before=(await call('/food/admin/stores',undefined,admin)).data.length;
 const row={...own};delete row.id;row.name='坐标导入回滚测试';
 assert.notEqual((await call('/food/admin/stores/import',[{...row,latitude:0,longitude:0},{...row,latitude:91,longitude:0}],admin)).code,200);
 assert.equal((await call('/food/admin/stores',undefined,admin)).data.length,before);
 console.log('PASS merchant isolation, coordinate pair/range validation, zero coordinates, cache invalidation, nullable fields, import rollback; original coordinates restored');
})().catch(e=>{console.error(e);process.exitCode=1});
