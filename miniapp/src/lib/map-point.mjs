import transform from 'coordtransform'
export function fromGcj02(p){const latitude=Number(p.latitude),longitude=Number(p.longitude);if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('地图返回的坐标不合法');const [lng,lat]=transform.gcj02towgs84(longitude,latitude);return {latitude:lat,longitude:lng}}
