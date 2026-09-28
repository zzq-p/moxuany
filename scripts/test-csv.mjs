import assert from 'node:assert/strict'
import {parseCsv,serializeCsv} from '../admin/src/views/food/csv.js'
import fs from 'node:fs'
const rows=[['store_id','name','category','description','image','price','stock','active'],['1','导入验收菜品','测试','含逗号, 引号"和换行\n第二行','/static/food/rice.jpg','1500','10','0']]
const csv='\uFEFF'+serializeCsv(rows)
assert.deepEqual(parseCsv(csv),rows)
assert.deepEqual(parseCsv('name,description\r\n鸡腿饭,现做\r\n'),[['name','description'],['鸡腿饭','现做']])
assert.deepEqual(parseCsv('""'),[['']])
assert.throws(()=>parseCsv('"未闭合'),/未闭合/)
assert.throws(()=>parseCsv('"内容"尾随文字'),/格式不正确/)
fs.mkdirSync('.runtime',{recursive:true})
fs.writeFileSync('.runtime/import-verification.csv',csv)
console.log('PASS CSV: Excel UTF-8 BOM, quoted commas/newlines, escaped quotes, CRLF and malformed input')
