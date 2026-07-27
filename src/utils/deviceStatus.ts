import type { DeviceOnlineStatus, DeviceStatusThresholds } from '@/api/types/device'
import dayjs from 'dayjs'

/**
 * 默认在线状态阈值。
 * 真实环境必须由服务端按设备实际上报周期下发，这里只作为服务端配置拉取失败时的兜底。
 */
export const DEFAULT_STATUS_THRESHOLDS: DeviceStatusThresholds = {
  onlineSeconds: 60,
  staleSeconds: 300,
}

/**
 * 按最后定位时间判定在线状态
 *
 * 页面停留期间数据会自然变旧，所以本地也要能重算，
 * 不能一直沿用进入页面时服务端给的状态，否则会用「实时位置」掩盖旧数据。
 */
export function resolveOnlineStatus(
  recordedAt: string | null | undefined,
  thresholds: DeviceStatusThresholds = DEFAULT_STATUS_THRESHOLDS,
  now: number = Date.now(),
): DeviceOnlineStatus {
  if (!recordedAt) {
    return 'never'
  }
  const recorded = dayjs(recordedAt)
  if (!recorded.isValid()) {
    return 'never'
  }
  // 设备时钟超前时 diff 为负，按「刚刚上报」处理
  const elapsedSeconds = Math.max(0, (now - recorded.valueOf()) / 1000)

  if (elapsedSeconds <= thresholds.onlineSeconds) {
    return 'online'
  }
  if (elapsedSeconds <= thresholds.staleSeconds) {
    return 'stale'
  }
  return 'offline'
}

/** 在线状态的展示元数据 */
export interface OnlineStatusMeta {
  label: string
  /** wd-tag 的 type */
  tagType: 'success' | 'warning' | 'danger' | 'default'
  /** 状态点颜色 */
  dotColor: string
  /** 页面顶部的解释文案 */
  hint: string
}

export const ONLINE_STATUS_META: Record<DeviceOnlineStatus, OnlineStatusMeta> = {
  online: {
    label: '在线',
    tagType: 'success',
    dotColor: '#34c759',
    hint: '刚刚更新',
  },
  stale: {
    label: '位置过期',
    tagType: 'warning',
    dotColor: '#ff9500',
    hint: '位置未在预期周期内更新，请注意数据时间',
  },
  offline: {
    label: '离线',
    tagType: 'default',
    dotColor: '#9a9a9a',
    hint: '设备已离线，以下为最后位置',
  },
  never: {
    label: '从未定位',
    tagType: 'danger',
    dotColor: '#fa4350',
    hint: '该设备没有有效定位点，请检查设备定位与网络',
  },
}

/**
 * 相对时间展示，如「12 秒前」
 * 超过 3 天直接展示具体日期，避免「87 小时前」这种无法快速换算的文案
 */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) {
    return '--'
  }
  const target = dayjs(iso)
  if (!target.isValid()) {
    return '--'
  }
  const elapsedSeconds = Math.max(0, Math.floor((now - target.valueOf()) / 1000))

  if (elapsedSeconds < 5) {
    return '刚刚'
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} 秒前`
  }
  if (elapsedSeconds < 3600) {
    return `${Math.floor(elapsedSeconds / 60)} 分钟前`
  }
  if (elapsedSeconds < 86400) {
    return `${Math.floor(elapsedSeconds / 3600)} 小时前`
  }
  if (elapsedSeconds < 86400 * 3) {
    return `${Math.floor(elapsedSeconds / 86400)} 天前`
  }
  return target.format('YYYY-MM-DD HH:mm')
}

/** 绝对时间展示，用于「不要用相对时间掩盖旧数据」的场景 */
export function formatDateTime(iso: string | null | undefined, template = 'YYYY-MM-DD HH:mm:ss'): string {
  if (!iso) {
    return '--'
  }
  const target = dayjs(iso)
  return target.isValid() ? target.format(template) : '--'
}

/** 仅时分秒，用于轨迹点气泡 */
export function formatClockTime(iso: string | null | undefined): string {
  return formatDateTime(iso, 'HH:mm:ss')
}

/**
 * 导航前是否需要风险提示
 * 位置超过 staleSeconds 未更新时，必须先说明「将导航到最后上报位置」
 */
export function needsStaleNavigationWarning(status: DeviceOnlineStatus): boolean {
  return status === 'offline' || status === 'stale'
}

/** 电量展示 */
export function formatBattery(battery: number | null | undefined): string {
  if (typeof battery !== 'number' || !Number.isFinite(battery)) {
    return '--'
  }
  return `${Math.round(battery)}%`
}

/** 定位精度展示 */
export function formatAccuracy(accuracy: number | null | undefined): string {
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) {
    return '--'
  }
  return `±${Math.round(accuracy)} 米`
}
