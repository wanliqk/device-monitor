import type { LatLng } from '@/api/types/device'

/** 地球平均半径，米（IUGG 平均半径） */
const EARTH_RADIUS_METERS = 6371008.8

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

/**
 * 经纬度合法性校验，对齐服务端接入校验规则
 * 经度 [-180, 180]，纬度 [-90, 90]，且必须是有限数
 */
export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return false
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false
  }
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

/** 两点间大圆距离，米 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLng = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h
    = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * 按相邻点累加的估算里程，米
 * 注意：必须传抽稀前的原始有效点，抽稀只影响绘制，不影响统计
 */
export function totalDistanceMeters(points: LatLng[]): number {
  if (points.length < 2) {
    return 0
  }
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i])
  }
  return total
}

/** 点到线段的垂直距离（在小范围内用平面近似即可），米 */
function perpendicularDistance(point: LatLng, start: LatLng, end: LatLng): number {
  // 以 start 为原点做等距圆柱投影，小范围（<100km）误差可忽略
  const latScale = 111_320
  const lngScale = 111_320 * Math.cos(toRadians(start.latitude))

  const px = (point.longitude - start.longitude) * lngScale
  const py = (point.latitude - start.latitude) * latScale
  const ex = (end.longitude - start.longitude) * lngScale
  const ey = (end.latitude - start.latitude) * latScale

  const segmentLengthSq = ex * ex + ey * ey
  if (segmentLengthSq === 0) {
    return Math.sqrt(px * px + py * py)
  }
  // 投影比例夹紧到 [0, 1]，退化为点到线段（而非直线）的距离
  const t = Math.max(0, Math.min(1, (px * ex + py * ey) / segmentLengthSq))
  const dx = px - t * ex
  const dy = py - t * ey
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Douglas-Peucker 抽稀，保留形状特征点
 * @param tolerance 误差阈值，米。偏移小于该值的点会被丢弃
 */
export function simplifyByTolerance<T extends LatLng>(points: T[], tolerance: number): T[] {
  if (points.length <= 2 || tolerance <= 0) {
    return points.slice()
  }

  const keep = Array.from<boolean>({ length: points.length }).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  // 用显式栈代替递归，避免长轨迹爆栈
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let maxDistance = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last])
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }

  return points.filter((_, i) => keep[i])
}

/**
 * 等间隔降采样，始终保留首尾点
 * 作为 Douglas-Peucker 之后的兜底，确保绘制点数不超过上限
 */
export function downsample<T>(points: T[], maxPoints: number): T[] {
  if (maxPoints < 2 || points.length <= maxPoints) {
    return points.slice()
  }
  const result: T[] = []
  // 在首尾之间均匀取 maxPoints - 1 个位置，最后单独补上末点
  const step = (points.length - 1) / (maxPoints - 1)
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(points[Math.round(i * step)])
  }
  result.push(points[points.length - 1])
  return result
}

/**
 * 轨迹抽稀：先按误差阈值保留形状，再按点数上限兜底
 * @param maxPoints 返回给小程序的最大绘制点数
 * @param tolerance 误差阈值，米
 */
export function simplifyTrack<T extends LatLng>(points: T[], maxPoints: number, tolerance = 5): T[] {
  if (points.length <= maxPoints) {
    return points.slice()
  }
  return downsample(simplifyByTolerance(points, tolerance), maxPoints)
}

/** 格式化经纬度，逆地理编码失败时直接展示 */
export function formatCoordinate(latitude: number, longitude: number, fractionDigits = 6): string {
  if (!isValidCoordinate(latitude, longitude)) {
    return '--'
  }
  return `${latitude.toFixed(fractionDigits)}, ${longitude.toFixed(fractionDigits)}`
}

/** 里程展示。1 公里以内用米，超过用公里 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return '--'
  }
  if (meters < 1000) {
    return `${Math.round(meters)} 米`
  }
  return `${(meters / 1000).toFixed(2)} 公里`
}

/** 速度展示。数据源为 m/s，页面按 km/h 展示更直观 */
export function formatSpeed(metersPerSecond: number | null | undefined): string {
  if (typeof metersPerSecond !== 'number' || !Number.isFinite(metersPerSecond) || metersPerSecond < 0) {
    return '--'
  }
  return `${(metersPerSecond * 3.6).toFixed(1)} km/h`
}
