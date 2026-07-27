import type {
  DeviceLatestLocationRes,
  DeviceListRes,
  DeviceRuntimeConfig,
  DeviceTrackRes,
  LocationUpdatedEvent,
} from '@/api/types/device'
import {
  alignedReportTime,
  buildDeviceList,
  buildLatestLocation,
  buildTrack,
  latestLocationOf,
  MOCK_RUNTIME_CONFIG,
} from './deviceGenerator'
import { findMockProfile } from './deviceProfiles'

/**
 * 伪服务端。
 *
 * 只负责「像服务端一样」响应：带网络时延、对越权设备统一返回资源不可见、
 * 通过模拟通道推送位置事件。页面不感知这一层，切换真实后端时只改 src/api/device.ts。
 */

/** 模拟网络时延区间，毫秒 */
const LATENCY_RANGE: [number, number] = [180, 420]

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function randomLatency() {
  const [min, max] = LATENCY_RANGE
  return min + Math.random() * (max - min)
}

/**
 * 设备不存在或无权限时的统一响应。
 * 按 MVP 安全要求，不区分「不存在」和「无权限」，避免泄露设备是否存在。
 */
export class DeviceNotVisibleError extends Error {
  constructor(public deviceId: string) {
    super('设备不存在或您没有查看权限')
    this.name = 'DeviceNotVisibleError'
  }
}

function requireProfile(deviceId: string) {
  const profile = findMockProfile(deviceId)
  if (!profile || profile.status !== 'active') {
    throw new DeviceNotVisibleError(deviceId)
  }
  return profile
}

/** 服务端运行时配置（状态阈值、轨迹上限） */
export async function mockGetRuntimeConfig(): Promise<DeviceRuntimeConfig> {
  await delay(randomLatency())
  return JSON.parse(JSON.stringify(MOCK_RUNTIME_CONFIG))
}

/** 设备列表 */
export async function mockGetDeviceList(
  params: { keyword?: string, cursor?: string | null, limit?: number } = {},
): Promise<DeviceListRes> {
  await delay(randomLatency())
  return buildDeviceList(params, Date.now())
}

/** 最新位置 */
export async function mockGetLatestLocation(deviceId: string): Promise<DeviceLatestLocationRes> {
  await delay(randomLatency())
  return buildLatestLocation(requireProfile(deviceId), Date.now())
}

/** 历史轨迹 */
export async function mockGetTrack(params: {
  deviceId: string
  startAt: string
  endAt: string
  maxPoints?: number
}): Promise<DeviceTrackRes> {
  const profile = requireProfile(params.deviceId)
  // 轨迹查询更重，时延也更高
  await delay(randomLatency() * 2)
  return buildTrack(profile, params, Date.now())
}

/** 模拟 WSS 连接的句柄 */
export interface MockLocationStream {
  /** 主动断开，页面卸载时必须调用 */
  close: () => void
  /** 模拟链路异常断开，用于本地验证重连与轮询降级 */
  simulateDrop: () => void
}

export interface MockLocationStreamHandlers {
  onOpen?: () => void
  onEvent?: (event: LocationUpdatedEvent) => void
  onClose?: (reason: 'manual' | 'dropped') => void
}

/**
 * 模拟 `wss://.../ws/v1` 的位置推送。
 *
 * 与真实通道保持一致的语义：
 * - 连接建立有握手时延；
 * - 只推送该设备的新定位点，事件带 eventId 供客户端去重；
 * - 从未定位的设备不会产生事件。
 */
export function openMockLocationStream(
  deviceId: string,
  handlers: MockLocationStreamHandlers = {},
): MockLocationStream {
  const profile = findMockProfile(deviceId)
  let closed = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastRecordedAt = ''

  const stop = (reason: 'manual' | 'dropped') => {
    if (closed) {
      return
    }
    closed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    handlers.onClose?.(reason)
  }

  // 握手时延后再开始推送
  const openTimer = setTimeout(() => {
    if (closed || !profile) {
      return
    }
    handlers.onOpen?.()

    const push = () => {
      const now = Date.now()
      const location = latestLocationOf(profile, now)
      if (!location || location.recordedAt === lastRecordedAt) {
        return
      }
      lastRecordedAt = location.recordedAt
      handlers.onEvent?.({
        type: 'location.updated',
        eventId: `evt_${profile.id}_${alignedReportTime(profile, now)}`,
        deviceId: profile.id,
        location,
      })
    }

    push()
    // 用比上报周期更密的心跳轮询「服务端是否有新点」，模拟服务端主动推送的到达节奏
    timer = setInterval(push, Math.min(profile.reportIntervalSeconds * 1000, 5000))
  }, 300)

  return {
    close: () => {
      clearTimeout(openTimer)
      stop('manual')
    },
    simulateDrop: () => {
      clearTimeout(openTimer)
      stop('dropped')
    },
  }
}
