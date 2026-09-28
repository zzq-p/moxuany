export function parseCsv(text) {
  // Excel's UTF-8 CSV and our downloadable templates begin with a BOM.
  text = text.replace(/^\uFEFF/, '')
  const rows = []
  let row = [], cell = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else cell += c
    } else if (c === ',') {
      row.push(cell); cell = ''; closed = false
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''; closed = false
    } else if (c === '"' && !closed && cell.length === 0) {
      quoted = true
    } else {
      if (closed || c === '"') throw Error('CSV引号格式不正确')
      cell += c
    }
  }
  if (quoted) throw Error('CSV引号未闭合')
  if (cell.length || row.length || closed) { row.push(cell); rows.push(row) }
  return rows
}
export function serializeCsv(rows){return rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')}
