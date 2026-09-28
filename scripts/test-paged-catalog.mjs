import assert from 'node:assert/strict'
import {createPagedCatalog,queryString} from '../miniapp/src/lib/paged-catalog.mjs'
const state={rows:[],total:0,page:0,loading:false,error:''},requests=[]
const feed=createPagedCatalog(state,q=>new Promise((resolve,reject)=>requests.push({q,resolve,reject})))
const old=feed.load({q:'old'}),fresh=feed.load({q:'new'})
requests[1].resolve({rows:[{id:2}],total:3,page:1});await fresh
requests[0].resolve({rows:[{id:1}],total:9,page:1});await old
assert.deepEqual(state.rows,[{id:2}]);assert.equal(state.total,3)
const more=feed.load(null,true);await feed.load(null,true);assert.equal(requests.length,3);assert.deepEqual(requests[2].q,{q:'new',page:2})
requests[2].resolve({rows:[{id:2},{id:3}],total:3,page:2});await more;assert.deepEqual(state.rows,[{id:2},{id:3}])
const fail=feed.load(null,true);requests[3].reject(Error('offline'));await fail;assert.equal(state.page,2);assert.equal(state.rows.length,2);assert.equal(state.error,'offline')
const retry=feed.load(null,true);assert.equal(requests[4].q.page,3);requests[4].resolve({rows:[{id:4}],total:3,page:3});await retry;await feed.load(null,true);assert.equal(requests.length,5)
const hidden=feed.load({q:'hidden'});feed.cancel();requests[5].resolve({rows:[{id:99}],total:1,page:1});await hidden;assert.equal(state.rows.length,0);assert.equal(state.loading,false)
assert.equal(queryString({q:'米饭 &%',category:'',skip:null,page:2}),'q=%E7%B1%B3%E9%A5%AD%20%26%25&page=2')
console.log('PASS catalog stale responses, append deduplication, overlapping load guard, retry page, end-of-list, cancellation and URL encoding')
