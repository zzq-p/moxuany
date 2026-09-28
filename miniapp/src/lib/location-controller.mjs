import { coordinates } from './geo.mjs'
export const initialLocation = () => ({ point: null, label: '选择位置', zone: '全部', busy: false, error: '', hint: '', locatedAt: 0 })
export function createLocationController(state, acquire, resolveCity, now = Date.now) {
  let revision = 0
  function clear() { revision++; Object.assign(state, initialLocation()) }
  function manual(zone) { clear(); state.zone = zone; state.label = '手动选择' }
  function expire() {
    if (state.point && now() - state.locatedAt >= 10 * 60 * 1000) { clear(); state.hint = '位置已过期，请重新定位' }
  }
  async function locate() {
    if (state.busy) return
    clear(); state.busy = true
    const attempt = revision
    try {
      const result = await acquire()
      if (attempt !== revision) return
      const point = coordinates(result.latitude, result.longitude)
      if (!point) throw Error('定位结果无效，请重试')
      state.point = point; state.locatedAt = now(); state.label = '当前位置'
      try {
        const city = await resolveCity(point)
        if (attempt !== revision) return
        state.label = city.label || '当前位置'
        state.hint = city.resolved ? '定位成功，距离为直线估算' : '已获取位置，暂时无法显示城市名称；距离仍可计算'
      } catch { if (attempt === revision) state.hint = '已获取位置，城市名称暂不可用；距离仍可计算' }
    } catch (e) {
      if (attempt !== revision) return
      const message = String(e.errMsg || e.message || '')
      state.error = /deny|denied|auth|permission/i.test(message) ? '未获得定位权限。可以手动选择区域，或在浏览器 / 微信设置中允许定位后重试。' : /timeout|超时/i.test(message) ? '定位超时，请检查设备定位与网络后重试，也可以手动选择区域。' : '暂时无法定位，请检查设备定位与网络，或手动选择区域。'
    } finally { if (attempt === revision) state.busy = false }
  }
  return { locate, manual, clear, expire }
}
