import { reactive } from 'vue'
import { request } from './api'
import { initialLocation, createLocationController } from './location-controller.mjs'
export const location = reactive(initialLocation())
export function acquire() {
  return new Promise((resolve, reject) => {
    // Ignore late callbacks after the application deadline; never prompt on page load.
    const timer = setTimeout(() => reject(Error('定位超时')), 12000)
    const success = p => { clearTimeout(timer); resolve(p) }
    const fail = e => { clearTimeout(timer); reject(e) }
    try {
      // #ifdef H5
      if (!navigator.geolocation) { fail(Error('设备不支持定位')); return }
      navigator.geolocation.getCurrentPosition(p => success(p.coords), fail, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 })
      // #endif
      // #ifndef H5
      uni.getLocation({ type: 'wgs84', success, fail })
      // #endif
    } catch (e) { fail(e) }
  })
}
export const locationActions = createLocationController(location, acquire, point => request('/location/reverse', 'POST', point, true))
