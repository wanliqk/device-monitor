import type { LatLng } from '@/api/types/device'
import { describe, expect, it } from 'vitest'
import {
  downsample,
  formatCoordinate,
  formatDistance,
  formatSpeed,
  haversineMeters,
  isValidCoordinate,
  simplifyByTolerance,
  simplifyTrack,
  totalDistanceMeters,
} from './geo'

describe('isValidCoordinate', () => {
  it('接受边界内的合法坐标', () => {
    expect(isValidCoordinate(31.2304, 121.4737)).toBe(true)
    expect(isValidCoordinate(-90, -180)).toBe(true)
    expect(isValidCoordinate(90, 180)).toBe(true)
  })

  it('拒绝越界坐标', () => {
    expect(isValidCoordinate(90.1, 0)).toBe(false)
    expect(isValidCoordinate(0, 180.1)).toBe(false)
  })

  it('拒绝非有限数与非数字', () => {
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false)
    expect(isValidCoordinate(0, Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidCoordinate('31.2' as unknown, 121)).toBe(false)
    expect(isValidCoordinate(null, undefined)).toBe(false)
  })
})

describe('haversineMeters', () => {
  it('同一点距离为 0', () => {
    const p: LatLng = { latitude: 31.2304, longitude: 121.4737 }
    expect(haversineMeters(p, p)).toBe(0)
  })

  it('纬度相差 1 度约为 111 公里', () => {
    const distance = haversineMeters(
      { latitude: 31, longitude: 121 },
      { latitude: 32, longitude: 121 },
    )
    expect(distance).toBeGreaterThan(111_000)
    expect(distance).toBeLessThan(111_400)
  })

  it('上海人民广场到外滩约 2 公里量级', () => {
    const distance = haversineMeters(
      { latitude: 31.2304, longitude: 121.4737 },
      { latitude: 31.2397, longitude: 121.4900 },
    )
    expect(distance).toBeGreaterThan(1500)
    expect(distance).toBeLessThan(2500)
  })
})

describe('totalDistanceMeters', () => {
  it('少于两个点时为 0', () => {
    expect(totalDistanceMeters([])).toBe(0)
    expect(totalDistanceMeters([{ latitude: 31, longitude: 121 }])).toBe(0)
  })

  it('等于各相邻段距离之和', () => {
    const points: LatLng[] = [
      { latitude: 31.0, longitude: 121.0 },
      { latitude: 31.001, longitude: 121.0 },
      { latitude: 31.002, longitude: 121.0 },
    ]
    const expected
      = haversineMeters(points[0], points[1]) + haversineMeters(points[1], points[2])
    expect(totalDistanceMeters(points)).toBeCloseTo(expected, 6)
  })
})

describe('simplifyByTolerance', () => {
  it('直线上的中间点会被丢弃', () => {
    const points: LatLng[] = [
      { latitude: 31.0, longitude: 121.0 },
      { latitude: 31.001, longitude: 121.0 },
      { latitude: 31.002, longitude: 121.0 },
      { latitude: 31.003, longitude: 121.0 },
    ]
    const result = simplifyByTolerance(points, 5)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(points[0])
    expect(result[1]).toEqual(points[3])
  })

  it('保留超出误差阈值的拐点', () => {
    const points: LatLng[] = [
      { latitude: 31.0, longitude: 121.0 },
      { latitude: 31.0, longitude: 121.002 }, // 偏离直线约 200 米
      { latitude: 31.002, longitude: 121.0 },
    ]
    const result = simplifyByTolerance(points, 5)
    expect(result).toHaveLength(3)
  })

  it('点数不足或阈值非正时原样返回', () => {
    const points: LatLng[] = [
      { latitude: 31, longitude: 121 },
      { latitude: 32, longitude: 121 },
    ]
    expect(simplifyByTolerance(points, 5)).toEqual(points)
    expect(simplifyByTolerance(points, 0)).toEqual(points)
  })
})

describe('downsample', () => {
  it('点数未超上限时原样返回', () => {
    const points = [1, 2, 3]
    expect(downsample(points, 5)).toEqual(points)
  })

  it('降采样后点数等于上限且保留首尾', () => {
    const points = Array.from({ length: 100 }, (_, i) => i)
    const result = downsample(points, 10)
    expect(result).toHaveLength(10)
    expect(result[0]).toBe(0)
    expect(result[result.length - 1]).toBe(99)
  })
})

describe('simplifyTrack', () => {
  it('返回点数不超过 maxPoints 且保留首尾', () => {
    // 构造一条带噪声的折线，确保 Douglas-Peucker 之后仍然超限
    const points: LatLng[] = Array.from({ length: 5000 }, (_, i) => ({
      latitude: 31 + i * 0.0001,
      longitude: 121 + (i % 2 === 0 ? 0.0005 : -0.0005),
    }))
    const result = simplifyTrack(points, 2000)
    expect(result.length).toBeLessThanOrEqual(2000)
    expect(result[0]).toEqual(points[0])
    expect(result[result.length - 1]).toEqual(points[points.length - 1])
  })

  it('原始点数未超限时不做抽稀', () => {
    const points: LatLng[] = Array.from({ length: 10 }, (_, i) => ({
      latitude: 31 + i * 0.001,
      longitude: 121,
    }))
    expect(simplifyTrack(points, 2000)).toEqual(points)
  })
})

describe('格式化函数', () => {
  it('formatCoordinate 保留 6 位小数，非法坐标返回占位符', () => {
    expect(formatCoordinate(31.2304, 121.4737)).toBe('31.230400, 121.473700')
    expect(formatCoordinate(999, 121)).toBe('--')
  })

  it('formatDistance 按公里/米切换', () => {
    expect(formatDistance(0)).toBe('0 米')
    expect(formatDistance(860.4)).toBe('860 米')
    expect(formatDistance(1234)).toBe('1.23 公里')
    expect(formatDistance(-1)).toBe('--')
  })

  it('formatSpeed 把 m/s 换算为 km/h', () => {
    expect(formatSpeed(0)).toBe('0.0 km/h')
    expect(formatSpeed(10)).toBe('36.0 km/h')
    expect(formatSpeed(null)).toBe('--')
    expect(formatSpeed(-3)).toBe('--')
  })
})
