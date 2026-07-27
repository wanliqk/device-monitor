import type {
  DeviceLatestLocationRes,
  DeviceListRes,
  DeviceLocation,
  DeviceSummary,
  DeviceTrackRes,
  LatLng,
  TrackPoint,
} from '@/api/types/device'
import type { MockDeviceProfile } from './deviceProfiles'
import { resolveOnlineStatus } from '@/utils/deviceStatus'
import { haversineMeters, simplifyTrack, totalDistanceMeters } from '@/utils/geo'
import { MOCK_DEVICE_PROFILES } from './deviceProfiles'

/**
 * 伪数据生成器：位置是「设备档案 + 时间戳」的纯函数。
 *
 * 这样做的原因：
 * 1. 同一时刻重复查询结果一致，最新位置与轨迹末点天然对齐；
 * 2. 页面刷新、重连、轮询降级都不会让 Marker 跳来跳去；
 * 3. 单元测试可以传入固定时间戳断言，无需 mock 计时器。
 */

/** 服务端下发的运行时配置（伪数据） */
export const MOCK_RUNTIME_CONFIG = {
  thresholds: {
    onlineSeconds: 60,
    staleSeconds: 300,
  },
  maxTrackRangeHours: 24,
  maxTrackPoints: 2000,
}

/** 低精度判定阈值，米。超过该值的点不进入默认轨迹 */
const LOW_ACCURACY_THRESHOLD = 80
/** 不可能的瞬时速度，m/s（约 360 km/h）。超过即判定为跳点 */
const IMPOSSIBLE_SPEED_MPS = 100

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** mulberry32：由整数种子得到 [0, 1) 的确定性伪随机数 */
function mulberry32(seed: number): number {
  let t = (seed + 0x6D2B79F5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** 对 (设备, 时刻, 用途) 三元组取确定性噪声 */
function noise(deviceId: string, timestampMs: number, salt: string): number {
  return mulberry32(hashString(`${deviceId}:${timestampMs}:${salt}`))
}

/** 闭合路线，让设备可以循环行驶 */
function closedRoute(route: LatLng[]): LatLng[] {
  if (route.length < 2) {
    return route.slice()
  }
  return [...route, route[0]]
}

/** 沿闭合路线按累计里程取插值点，同时返回该段的航向 */
function pointAlongRoute(route: LatLng[], distanceMeters: number): { point: LatLng, heading: number } {
  const path = closedRoute(route)
  const segments = path.slice(1).map((end, i) => ({
    start: path[i],
    end,
    length: haversineMeters(path[i], end),
  }))
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0)

  if (perimeter === 0) {
    return { point: path[0], heading: 0 }
  }

  let remaining = ((distanceMeters % perimeter) + perimeter) % perimeter
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = segment.length === 0 ? 0 : remaining / segment.length
      const point = {
        latitude: segment.start.latitude + (segment.end.latitude - segment.start.latitude) * ratio,
        longitude: segment.start.longitude + (segment.end.longitude - segment.start.longitude) * ratio,
      }
      const heading = bearing(segment.start, segment.end)
      return { point, heading }
    }
    remaining -= segment.length
  }

  const last = segments[segments.length - 1]
  return { point: last.end, heading: bearing(last.start, last.end) }
}

/** 两点间的正北航向角，0~359 度 */
function bearing(from: LatLng, to: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const y = Math.sin(toRad(to.longitude - from.longitude)) * Math.cos(toRad(to.latitude))
  const x
    = Math.cos(toRad(from.latitude)) * Math.sin(toRad(to.latitude))
      - Math.sin(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.cos(toRad(to.longitude - from.longitude))
  const degrees = (Math.atan2(y, x) * 180) / Math.PI
  return Math.round((degrees + 360) % 360)
}

/** 设备「自己的当前时间」：扣掉固定滞后后，再对齐到上报周期 */
export function alignedReportTime(profile: MockDeviceProfile, now: number): number {
  const intervalMs = profile.reportIntervalSeconds * 1000
  const deviceNow = now - profile.reportLagSeconds * 1000
  return Math.floor(deviceNow / intervalMs) * intervalMs
}

/** 电量：随时间缓慢下降并循环，静止设备耗电更慢 */
function batteryAt(profile: MockDeviceProfile, timestampMs: number): number | null {
  if (!profile.hasBattery) {
    return null
  }
  const drainPerHour = profile.motion === 'moving' ? 6 : 1.5
  const hours = timestampMs / 3_600_000
  const drained = (hours * drainPerHour) % 90
  return Math.round(100 - drained)
}

/**
 * 生成某个时刻的定位点
 * @param timestampMs 已对齐上报周期的时间戳
 * @param options.withAnomaly 是否注入低精度点与跳点（轨迹用；最新位置不注入，避免 Marker 乱跳）
 */
export function locationAt(
  profile: MockDeviceProfile,
  timestampMs: number,
  options: { withAnomaly?: boolean } = {},
): DeviceLocation | null {
  if (profile.motion === 'none' || profile.route.length === 0) {
    return null
  }

  const seconds = timestampMs / 1000
  let base: LatLng
  let heading: number | null = null
  let speed: number

  if (profile.motion === 'moving') {
    const traveled = seconds * profile.speedMps
    const result = pointAlongRoute(profile.route, traveled)
    base = result.point
    heading = result.heading
    // 速度在标称值上下浮动 ±15%
    speed = profile.speedMps * (0.85 + noise(profile.id, timestampMs, 'speed') * 0.3)
  }
  else {
    base = profile.route[0]
    speed = 0
  }

  // GPS 漂移：静止设备约 ±5 米，行驶设备约 ±2 米
  const driftScale = profile.motion === 'idle' ? 0.00005 : 0.00002
  let latitude = base.latitude + (noise(profile.id, timestampMs, 'lat') - 0.5) * 2 * driftScale
  let longitude = base.longitude + (noise(profile.id, timestampMs, 'lng') - 0.5) * 2 * driftScale

  // 精度：多数点在 5~35 米
  let accuracy = 5 + Math.round(noise(profile.id, timestampMs, 'acc') * 30)

  if (options.withAnomaly) {
    // 约 3% 的点标记为低精度，服务端会把它们排除出默认轨迹
    if (noise(profile.id, timestampMs, 'lowAcc') > 0.97) {
      accuracy = LOW_ACCURACY_THRESHOLD + 20 + Math.round(noise(profile.id, timestampMs, 'lowAccV') * 200)
    }
    // 约 0.4% 的点是跳点，偏移到几公里外
    if (noise(profile.id, timestampMs, 'jump') > 0.996) {
      latitude += 0.05
      longitude += 0.05
    }
  }

  const addressIndex = profile.addressPool.length === 0
    ? -1
    : Math.floor(noise(profile.id, timestampMs, 'addr') * profile.addressPool.length) % profile.addressPool.length

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    coordinateSystem: 'gcj02',
    recordedAt: new Date(timestampMs).toISOString(),
    // 服务端接收比设备采集晚 0.3~1.3 秒
    receivedAt: new Date(timestampMs + 300 + Math.round(noise(profile.id, timestampMs, 'recv') * 1000)).toISOString(),
    accuracy,
    speed: Number(speed.toFixed(2)),
    heading,
    battery: batteryAt(profile, timestampMs),
    address: addressIndex < 0 ? null : profile.addressPool[addressIndex],
  }
}

/** 设备的最新定位点 */
export function latestLocationOf(profile: MockDeviceProfile, now: number): DeviceLocation | null {
  return locationAt(profile, alignedReportTime(profile, now))
}

/** 设备最后通信时间。从未定位的设备通信仍然正常，用于区分「定位失败」和「设备失联」 */
export function lastSeenAtOf(profile: MockDeviceProfile, now: number): string | null {
  if (profile.motion === 'none') {
    // 通信正常但拿不到定位：最后通信时间贴近当前时间
    return new Date(now - 30_000).toISOString()
  }
  return new Date(alignedReportTime(profile, now)).toISOString()
}

/** 构造设备列表项 */
export function buildDeviceSummary(profile: MockDeviceProfile, now: number): DeviceSummary {
  const location = latestLocationOf(profile, now)
  return {
    id: profile.id,
    externalId: profile.externalId,
    name: profile.name,
    status: profile.status,
    lastSeenAt: lastSeenAtOf(profile, now),
    onlineStatus: resolveOnlineStatus(location?.recordedAt ?? null, MOCK_RUNTIME_CONFIG.thresholds, now),
    location,
  }
}

/** 设备列表查询，支持按名称或设备编号搜索 + 游标分页 */
export function buildDeviceList(
  params: { keyword?: string, cursor?: string | null, limit?: number } = {},
  now: number = Date.now(),
): DeviceListRes {
  const keyword = (params.keyword ?? '').trim().toLowerCase()
  const limit = params.limit ?? 20

  const matched = MOCK_DEVICE_PROFILES.filter((profile) => {
    if (!keyword) {
      return true
    }
    return profile.name.toLowerCase().includes(keyword)
      || profile.externalId.toLowerCase().includes(keyword)
  })

  const startIndex = params.cursor ? matched.findIndex(profile => profile.id === params.cursor) + 1 : 0
  const page = matched.slice(startIndex, startIndex + limit)
  const nextIndex = startIndex + page.length

  return {
    items: page.map(profile => buildDeviceSummary(profile, now)),
    nextCursor: nextIndex < matched.length ? page[page.length - 1].id : null,
  }
}

/** 最新位置查询 */
export function buildLatestLocation(profile: MockDeviceProfile, now: number = Date.now()): DeviceLatestLocationRes {
  const location = latestLocationOf(profile, now)
  return {
    deviceId: profile.id,
    name: profile.name,
    status: resolveOnlineStatus(location?.recordedAt ?? null, MOCK_RUNTIME_CONFIG.thresholds, now),
    lastSeenAt: lastSeenAtOf(profile, now),
    location,
  }
}

function toTrackPoint(location: DeviceLocation): TrackPoint {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    recordedAt: location.recordedAt,
    speed: location.speed,
    accuracy: location.accuracy,
  }
}

/**
 * 轨迹查询
 *
 * 服务端职责在这里完整模拟：
 * 1. 裁剪时间范围（不超过 maxTrackRangeHours，且不晚于设备最后上报时间）；
 * 2. 标记并过滤低精度点与瞬时速度异常的跳点；
 * 3. 里程按抽稀前的原始有效点计算；
 * 4. 抽稀只影响绘制点，并在响应里返回抽稀前后点数。
 */
export function buildTrack(
  profile: MockDeviceProfile,
  params: { startAt: string, endAt: string, maxPoints?: number },
  now: number = Date.now(),
): DeviceTrackRes {
  const maxPoints = params.maxPoints ?? MOCK_RUNTIME_CONFIG.maxTrackPoints
  const maxRangeMs = MOCK_RUNTIME_CONFIG.maxTrackRangeHours * 3_600_000

  const requestedStart = new Date(params.startAt).getTime()
  const requestedEnd = new Date(params.endAt).getTime()

  // 结束时间不能晚于「现在」，也不能晚于该设备的最后上报时间
  const deviceLatest = alignedReportTime(profile, now)
  const endMs = Math.min(requestedEnd, deviceLatest)
  // 起始时间受 24 小时上限约束
  const startMs = Math.max(requestedStart, endMs - maxRangeMs)

  const empty: DeviceTrackRes = {
    deviceId: profile.id,
    startAt: new Date(Math.min(startMs, endMs)).toISOString(),
    endAt: new Date(endMs).toISOString(),
    rawPointCount: 0,
    pointCount: 0,
    points: [],
    startPoint: null,
    endPoint: null,
    distanceMeters: 0,
    deviceEverReported: profile.motion !== 'none',
    qualityNotes: [],
  }

  if (profile.motion === 'none' || profile.route.length === 0 || startMs >= endMs) {
    return empty
  }

  const intervalMs = profile.reportIntervalSeconds * 1000
  const firstTick = Math.ceil(startMs / intervalMs) * intervalMs

  const rawLocations: DeviceLocation[] = []
  for (let t = firstTick; t <= endMs; t += intervalMs) {
    const location = locationAt(profile, t, { withAnomaly: true })
    if (location) {
      rawLocations.push(location)
    }
  }

  if (rawLocations.length === 0) {
    return empty
  }

  // 1) 过滤低精度点
  const accuracyFiltered = rawLocations.filter(
    location => (location.accuracy ?? 0) <= LOW_ACCURACY_THRESHOLD,
  )
  const lowAccuracyCount = rawLocations.length - accuracyFiltered.length

  // 2) 过滤瞬时速度不可能的跳点
  const validLocations: DeviceLocation[] = []
  let jumpCount = 0
  for (const location of accuracyFiltered) {
    const previous = validLocations[validLocations.length - 1]
    if (previous) {
      const elapsedSeconds
        = (new Date(location.recordedAt).getTime() - new Date(previous.recordedAt).getTime()) / 1000
      const instantSpeed = elapsedSeconds > 0
        ? haversineMeters(previous, location) / elapsedSeconds
        : Number.POSITIVE_INFINITY
      if (instantSpeed > IMPOSSIBLE_SPEED_MPS) {
        jumpCount++
        continue
      }
    }
    validLocations.push(location)
  }

  if (validLocations.length === 0) {
    return { ...empty, rawPointCount: 0 }
  }

  const validPoints = validLocations.map(toTrackPoint)
  // 里程按抽稀前的原始有效点计算，抽稀只影响绘制
  const distanceMeters = totalDistanceMeters(validPoints)
  const drawPoints = simplifyTrack(validPoints, maxPoints)

  const qualityNotes: string[] = []
  if (lowAccuracyCount > 0) {
    qualityNotes.push(`已过滤 ${lowAccuracyCount} 个低精度点`)
  }
  if (jumpCount > 0) {
    qualityNotes.push(`已过滤 ${jumpCount} 个异常跳点`)
  }
  if (drawPoints.length < validPoints.length) {
    qualityNotes.push(`原始 ${validPoints.length} 点已抽稀为 ${drawPoints.length} 点绘制`)
  }

  return {
    deviceId: profile.id,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    rawPointCount: validPoints.length,
    pointCount: drawPoints.length,
    points: drawPoints,
    startPoint: validPoints[0],
    endPoint: validPoints[validPoints.length - 1],
    distanceMeters,
    deviceEverReported: true,
    qualityNotes,
  }
}
