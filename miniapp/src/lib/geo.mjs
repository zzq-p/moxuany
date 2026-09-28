// All coordinates here are WGS84 (GPS); never use the legacy store.distance field.
export function coordinates(latitude, longitude) {
  const valid = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v))
  if (!valid(latitude) || !valid(longitude)) return null
  const lat = Number(latitude), lng = Number(longitude)
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : null
}
export function distanceMeters(from, to) {
  const a = from && coordinates(from.latitude, from.longitude), b = to && coordinates(to.latitude, to.longitude)
  if (!a || !b) return null
  const rad = n => n * Math.PI / 180
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}
export function distanceText(from, store) {
  if (!from) return '定位后查看距离'
  const d = distanceMeters(from, store)
  if (d === null) return '距离待完善'
  return '直线 ' + (d < 1000 ? Math.round(d) + 'm' : (d / 1000).toFixed(1) + 'km')
}
export function compareDistance(from, a, b) {
  const da = distanceMeters(from, a), db = distanceMeters(from, b)
  if (da === null && db === null) return Number(b.rating) - Number(a.rating)
  if (da === null) return 1
  if (db === null) return -1
  return da - db || Number(b.rating) - Number(a.rating)
}
