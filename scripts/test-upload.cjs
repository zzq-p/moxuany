const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const base='http://127.0.0.1:8080';
 const auth=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'merchant_demo',password:'Merchant123!'})})).json();assert.equal(auth.code,200);
 const bytes=fs.readFileSync('miniapp/src/static/food/rice.jpg'),form=new FormData();form.append('file',new Blob([bytes],{type:'image/jpeg'}),'upload-verification.jpg');
 const result=await(await fetch(base+'/common/upload',{method:'POST',headers:{Authorization:'Bearer '+auth.token},body:form})).json();assert.equal(result.code,200,JSON.stringify(result));assert(result.fileName.startsWith('/profile/'));
 const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const origin of [base,'http://127.0.0.1:5173','http://127.0.0.1:5174/dev-api']){const response=await fetch(origin+result.fileName);assert.equal(response.status,200);assert.equal(digest(Buffer.from(await response.arrayBuffer())),digest(bytes));}
 const report=JSON.parse(fs.readFileSync('docs/test-report.json','utf8'));report.uploadCheck={passed:true,path:result.fileName,verified:['authenticated merchant upload','API static image','H5 image proxy','admin image proxy'],date:new Date().toISOString()};fs.writeFileSync('docs/test-report.json',JSON.stringify(report,null,2));console.log('PASS merchant image upload; byte-identical image served by API, H5 and admin proxy');
})().catch(e=>{console.error(e);process.exitCode=1});
