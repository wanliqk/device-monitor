import { describe, expect, it } from 'vitest'
import { haversineMeters } from '@/utils/geo'
import {
  alignedReportTime,
  buildDeviceList,
  buildLatestLocation,
  buildTrack,
  latestLocationOf,
  locationAt,
  MOCK_RUNTIME_CONFIG,
} from './deviceGenerator'
import { findMockProfile, MOCK_DEVICE_PROFILES } from './deviceProfiles'

/** 固定「当前时间」，让所有断言可复现 */
const NOW = new Date('2026-07-27T08:00:00Z').getTime()

function profileOf(id: string) {
  const profile = findMockProfile(id)
  if (!profile) {
    throw new Error(`测试数据缺失: ${id}`)
  }
  return profile
}

describe('alignedReportTime', () => {
  it('按上报周期对齐时间戳', () => {
    const profile = profileOf('dev_001') // 10 秒周期
    const aligned = alignedReportTime(profile, NOW + 7000)
    expect(aligned % 10_000).toBe(0)
    expect(aligned).toBeLessThanOrEqual(NOW + 7000)
  })

  it('扣除设备的固定上报滞后', () => {
    const profile = profileOf('dev_003') // 滞后 130 秒
    const aligned = alignedReportTime(profile, NOW)
    expect(NOW - aligned).toBeGreaterThanOrEqual(130_000)
  })
})

describe('locationAt', () => {
  it('同一时间戳重复调用结果完全一致', () => {
    const profile = profileOf('dev_001')
    expect(locationAt(profile, NOW)).toEqual(locationAt(profile, NOW))
  })

  it('从未定位的设备返回 null', () => {
    expect(locationAt(profileOf('dev_005'), NOW)).toBeNull()
  })

  it('行驶设备随时间移动且带航向', () => {
    const profile = profileOf('dev_001')
    const first = locationAt(profile, NOW)!
    const later = locationAt(profile, NOW + 60_000)!
    expect(haversineMeters(first, later)).toBeGreaterThan(50)
    expect(later.heading).toBeGreaterThanOrEqual(0)
    expect(later.heading).toBeLessThan(360)
  })

  it('静止设备只在小范围漂移，速度为 0', () => {
    const profile = profileOf('dev_002')
    const first = locationAt(profile, NOW)!
    const later = locationAt(profile, NOW + 600_000)!
    expect(haversineMeters(first, later)).toBeLessThan(30)
    expect(later.speed).toBe(0)
  })

  it('坐标系固定为 gcj02，接收时间不早于采集时间', () => {
    const location = locationAt(profileOf('dev_001'), NOW)!
    expect(location.coordinateSystem).toBe('gcj02')
    expect(new Date(location.receivedAt).getTime())
      .toBeGreaterThan(new Date(location.recordedAt).getTime())
  })

  it('不上报电量的设备 battery 为 null', () => {
    expect(locationAt(profileOf('dev_004'), NOW)!.battery).toBeNull()
  })

  it('逆地理编码文案池为空时 address 为 null', () => {
    expect(locationAt(profileOf('dev_002'), NOW)!.address).toBeNull()
  })
})

describe('buildDeviceList', () => {
  it('默认返回全部设备', () => {
    const result = buildDeviceList({}, NOW)
    expect(result.items).toHaveLength(MOCK_DEVICE_PROFILES.length)
    expect(result.nextCursor).toBeNull()
  })

  it('覆盖四种在线状态', () => {
    const statuses = buildDeviceList({}, NOW).items.map(item => item.onlineStatus)
    expect(statuses).toContain('online')
    expect(statuses).toContain('stale')
    expect(statuses).toContain('offline')
    expect(statuses).toContain('never')
  })

  it('支持按设备名称搜索', () => {
    const result = buildDeviceList({ keyword: '冷链' }, NOW)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('dev_002')
  })

  it('支持按设备编号搜索且忽略大小写', () => {
    const result = buildDeviceList({ keyword: 'imei-867295060234871' }, NOW)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('dev_001')
  })

  it('搜索无结果时返回空列表', () => {
    expect(buildDeviceList({ keyword: '不存在的设备' }, NOW).items).toHaveLength(0)
  })

  it('游标分页不重不漏', () => {
    const first = buildDeviceList({ limit: 2 }, NOW)
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBe(first.items[1].id)

    const second = buildDeviceList({ limit: 2, cursor: first.nextCursor }, NOW)
    const firstIds = first.items.map(item => item.id)
    const secondIds = second.items.map(item => item.id)
    expect(secondIds.some(id => firstIds.includes(id))).toBe(false)
  })

  it('从未定位的设备位置为 null，但最后通信时间仍然存在', () => {
    const device = buildDeviceList({ keyword: '新装设备' }, NOW).items[0]
    expect(device.location).toBeNull()
    expect(device.onlineStatus).toBe('never')
    expect(device.lastSeenAt).not.toBeNull()
  })
})

describe('buildLatestLocation', () => {
  it('在线设备的最新位置与列表一致', () => {
    const detail = buildLatestLocation(profileOf('dev_001'), NOW)
    const listItem = buildDeviceList({ keyword: '巡检车' }, NOW).items[0]
    expect(detail.location).toEqual(listItem.location)
    expect(detail.status).toBe('online')
  })

  it('滞后 130 秒的设备判定为位置过期', () => {
    expect(buildLatestLocation(profileOf('dev_003'), NOW).status).toBe('stale')
  })

  it('滞后 3 小时的设备判定为离线', () => {
    expect(buildLatestLocation(profileOf('dev_004'), NOW).status).toBe('offline')
  })
})

describe('buildTrack', () => {
  const startAt = new Date(NOW - 3600_000).toISOString()
  const endAt = new Date(NOW).toISOString()

  it('返回时间范围内的轨迹点，且首尾点与 points 对齐', () => {
    const track = buildTrack(profileOf('dev_001'), { startAt, endAt }, NOW)
    expect(track.pointCount).toBeGreaterThan(0)
    expect(track.points).toHaveLength(track.pointCount)
    expect(track.startPoint).not.toBeNull()
    expect(track.points[0]).toEqual(track.startPoint)
    expect(track.points[track.points.length - 1]).toEqual(track.endPoint)
  })

  it('绘制点数不超过 maxPoints，且 rawPointCount 记录抽稀前数量', () => {
    const track = buildTrack(profileOf('dev_001'), { startAt, endAt, maxPoints: 50 }, NOW)
    expect(track.pointCount).toBeLessThanOrEqual(50)
    expect(track.rawPointCount).toBeGreaterThan(track.pointCount)
    expect(track.qualityNotes.some(note => note.includes('抽稀'))).toBe(true)
  })

  it('里程按原始有效点计算，不受抽稀影响', () => {
    const dense = buildTrack(profileOf('dev_001'), { startAt, endAt }, NOW)
    const sparse = buildTrack(profileOf('dev_001'), { startAt, endAt, maxPoints: 20 }, NOW)
    expect(sparse.distanceMeters).toBeCloseTo(dense.distanceMeters, 6)
    expect(sparse.rawPointCount).toBe(dense.rawPointCount)
  })

  it('自定义范围超过 24 小时时被裁剪', () => {
    const track = buildTrack(
      profileOf('dev_001'),
      { startAt: new Date(NOW - 72 * 3600_000).toISOString(), endAt },
      NOW,
    )
    const rangeHours
      = (new Date(track.endAt).getTime() - new Date(track.startAt).getTime()) / 3600_000
    expect(rangeHours).toBeLessThanOrEqual(MOCK_RUNTIME_CONFIG.maxTrackRangeHours)
  })

  it('结束时间不会晚于设备最后上报时间', () => {
    const profile = profileOf('dev_004') // 滞后 3 小时
    const track = buildTrack(profile, { startAt: new Date(NOW - 6 * 3600_000).toISOString(), endAt }, NOW)
    const latest = latestLocationOf(profile, NOW)!
    expect(new Date(track.endAt).getTime())
      .toBeLessThanOrEqual(new Date(latest.recordedAt).getTime())
  })

  it('过滤低精度点，返回的绘制点精度都在阈值内', () => {
    const track = buildTrack(profileOf('dev_001'), { startAt, endAt }, NOW)
    expect(track.points.every(point => (point.accuracy ?? 0) <= 80)).toBe(true)
    expect(track.qualityNotes.some(note => note.includes('低精度'))).toBe(true)
  })

  it('从未定位的设备返回空轨迹并标记从未上报', () => {
    const track = buildTrack(profileOf('dev_005'), { startAt, endAt }, NOW)
    expect(track.points).toHaveLength(0)
    expect(track.deviceEverReported).toBe(false)
  })

  it('筛选范围内无数据但设备上报过时，deviceEverReported 为 true', () => {
    // dev_004 滞后 3 小时，查询最近 1 小时必然没有数据
    const track = buildTrack(profileOf('dev_004'), { startAt, endAt }, NOW)
    expect(track.points).toHaveLength(0)
    expect(track.deviceEverReported).toBe(true)
  })

  it('起止时间颠倒时返回空轨迹而不是抛错', () => {
    const track = buildTrack(profileOf('dev_001'), { startAt: endAt, endAt: startAt }, NOW)
    expect(track.points).toHaveLength(0)
  })
})
