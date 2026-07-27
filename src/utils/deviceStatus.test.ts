import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STATUS_THRESHOLDS,
  formatAccuracy,
  formatBattery,
  formatClockTime,
  formatDateTime,
  formatRelativeTime,
  needsStaleNavigationWarning,
  ONLINE_STATUS_META,
  resolveOnlineStatus,
} from './deviceStatus'

/** 固定「当前时间」，避免测试受真实时钟影响 */
const NOW = new Date('2026-07-27T08:00:00Z').getTime()

function isoBefore(seconds: number) {
  return new Date(NOW - seconds * 1000).toISOString()
}

describe('resolveOnlineStatus', () => {
  it('没有定位点时为 never', () => {
    expect(resolveOnlineStatus(null, DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('never')
    expect(resolveOnlineStatus(undefined, DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('never')
    expect(resolveOnlineStatus('', DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('never')
  })

  it('非法时间字符串为 never', () => {
    expect(resolveOnlineStatus('not-a-date', DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('never')
  })

  it('60 秒内为 online，边界值包含在内', () => {
    expect(resolveOnlineStatus(isoBefore(0), DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('online')
    expect(resolveOnlineStatus(isoBefore(59), DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('online')
    expect(resolveOnlineStatus(isoBefore(60), DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('online')
  })

  it('60~300 秒为 stale', () => {
    expect(resolveOnlineStatus(isoBefore(61), DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('stale')
    expect(resolveOnlineStatus(isoBefore(300), DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('stale')
  })

  it('超过 300 秒为 offline', () => {
    expect(resolveOnlineStatus(isoBefore(301), DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('offline')
    expect(resolveOnlineStatus(isoBefore(86400), DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('offline')
  })

  it('设备时钟超前时按在线处理，不会算出负的时长', () => {
    const future = new Date(NOW + 30_000).toISOString()
    expect(resolveOnlineStatus(future, DEFAULT_STATUS_THRESHOLDS, NOW)).toBe('online')
  })

  it('阈值可由服务端配置覆盖', () => {
    const thresholds = { onlineSeconds: 10, staleSeconds: 20 }
    expect(resolveOnlineStatus(isoBefore(15), thresholds, NOW)).toBe('stale')
    expect(resolveOnlineStatus(isoBefore(25), thresholds, NOW)).toBe('offline')
  })
})

describe('formatRelativeTime', () => {
  it('覆盖各时间量级', () => {
    expect(formatRelativeTime(isoBefore(2), NOW)).toBe('刚刚')
    expect(formatRelativeTime(isoBefore(12), NOW)).toBe('12 秒前')
    expect(formatRelativeTime(isoBefore(150), NOW)).toBe('2 分钟前')
    expect(formatRelativeTime(isoBefore(7200), NOW)).toBe('2 小时前')
    expect(formatRelativeTime(isoBefore(86400 * 2), NOW)).toBe('2 天前')
  })

  it('超过 3 天展示具体时间', () => {
    expect(formatRelativeTime(isoBefore(86400 * 5), NOW)).toMatch(/^2026-07-22 \d{2}:\d{2}$/)
  })

  it('空值与非法值返回占位符', () => {
    expect(formatRelativeTime(null, NOW)).toBe('--')
    expect(formatRelativeTime('bad', NOW)).toBe('--')
  })
})

describe('formatDateTime / formatClockTime', () => {
  it('格式化有效时间', () => {
    expect(formatDateTime('2026-07-27T08:00:00Z')).toMatch(/^2026-07-27 \d{2}:\d{2}:\d{2}$/)
    expect(formatClockTime('2026-07-27T08:00:00Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('空值返回占位符', () => {
    expect(formatDateTime(null)).toBe('--')
    expect(formatClockTime(undefined)).toBe('--')
  })
})

describe('needsStaleNavigationWarning', () => {
  it('位置过期和离线需要提示', () => {
    expect(needsStaleNavigationWarning('stale')).toBe(true)
    expect(needsStaleNavigationWarning('offline')).toBe(true)
  })

  it('在线不需要提示', () => {
    expect(needsStaleNavigationWarning('online')).toBe(false)
  })
})

describe('onlineStatusMeta 展示元数据', () => {
  it('四种状态都有展示元数据', () => {
    for (const status of ['online', 'stale', 'offline', 'never'] as const) {
      expect(ONLINE_STATUS_META[status].label).toBeTruthy()
      expect(ONLINE_STATUS_META[status].hint).toBeTruthy()
    }
  })
})

describe('formatBattery / formatAccuracy', () => {
  it('有值时正常展示', () => {
    expect(formatBattery(76.4)).toBe('76%')
    expect(formatAccuracy(12.6)).toBe('±13 米')
  })

  it('无值时返回占位符', () => {
    expect(formatBattery(null)).toBe('--')
    expect(formatAccuracy(undefined)).toBe('--')
    expect(formatAccuracy(-1)).toBe('--')
  })
})
