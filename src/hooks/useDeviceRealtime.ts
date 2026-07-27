import type { DeviceLocation } from '@/api/types/device'
import type { LocationStream, LocationStreamHandlers } from '@/api/deviceSocket'
import { ref } from 'vue'
import { openLocationStream as defaultOpenLocationStream } from '@/api/deviceSocket'
import { getDeviceLatestLocation } from '@/api/device'
import { trackEvent } from '@/utils/analytics'

/**
 * 实时链路状态
 * - `connecting`：正在建立连接
 * - `connected`：推送通道正常
 * - `reconnecting`：链路断开，正在指数退避重连，期间靠轮询兜底
 * - `closed`：页面已停止订阅
 */
export type RealtimeLinkStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export interface UseDeviceRealtimeOptions {
  /** 收到更新的位置时回调，`source` 用于埋点区分推送与轮询 */
  onLocation: (location: DeviceLocation, source: 'push' | 'poll') => void
  /** 重连期间的轮询间隔，默认 15 秒 */
  pollIntervalMs?: number
  /** 首次重连延迟，默认 1 秒，之后指数退避 */
  baseRetryMs?: number
  /** 退避上限，默认 30 秒 */
  maxRetryMs?: number
  /** 便于测试注入的连接工厂 */
  openStream?: (deviceId: string, handlers: LocationStreamHandlers) => LocationStream
  /** 便于测试注入的轮询请求 */
  fetchLatest?: typeof getDeviceLatestLocation
}

/**
 * 订阅单设备位置更新。
 *
 * 对齐 MVP 的实时更新与降级策略：
 * 1. 页面先用 REST 快照保证首屏，再由本 hook 建立推送通道；
 * 2. 事件按 eventId 去重，并忽略时间早于当前位置的乱序事件；
 * 3. 链路断开后指数退避重连，重连期间每 15 秒轮询一次最新位置；
 * 4. 进入后台时调用 `stop()`，回到前台重新 `start()`。
 */
export function useDeviceRealtime(options: UseDeviceRealtimeOptions) {
  const {
    onLocation,
    pollIntervalMs = 15_000,
    baseRetryMs = 1000,
    maxRetryMs = 30_000,
    openStream = defaultOpenLocationStream,
    fetchLatest = getDeviceLatestLocation,
  } = options

  const linkStatus = ref<RealtimeLinkStatus>('closed')
  /** 重连次数，用于展示与指数退避计算 */
  const retryCount = ref(0)

  let deviceId = ''
  let stream: LocationStream | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let stopped = true

  /** 已处理的事件 ID，用于去重；只保留最近若干个，避免长时间停留内存增长 */
  const seenEventIds: string[] = []
  const SEEN_LIMIT = 50
  /** 当前已展示位置的采集时间，用于丢弃乱序的旧事件 */
  let latestRecordedAtMs = 0

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function acceptLocation(location: DeviceLocation, source: 'push' | 'poll') {
    const recordedAtMs = new Date(location.recordedAt).getTime()
    if (!Number.isFinite(recordedAtMs) || recordedAtMs <= latestRecordedAtMs) {
      return false
    }
    latestRecordedAtMs = recordedAtMs
    onLocation(location, source)
    return true
  }

  async function pollOnce() {
    try {
      const snapshot = await fetchLatest(deviceId)
      if (!stopped && snapshot.location) {
        acceptLocation(snapshot.location, 'poll')
      }
    }
    catch (error) {
      console.warn('[realtime] 轮询最新位置失败', error)
    }
  }

  function startPolling() {
    if (pollTimer) {
      return
    }
    pollOnce()
    pollTimer = setInterval(pollOnce, pollIntervalMs)
  }

  function scheduleReconnect() {
    clearRetryTimer()
    // 指数退避：1s, 2s, 4s ... 上限 maxRetryMs
    const delay = Math.min(baseRetryMs * 2 ** retryCount.value, maxRetryMs)
    retryCount.value++
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!stopped) {
        connect()
      }
    }, delay)
  }

  function connect() {
    if (stopped) {
      return
    }
    linkStatus.value = retryCount.value > 0 ? 'reconnecting' : 'connecting'

    stream = openStream(deviceId, {
      onOpen: () => {
        if (stopped) {
          return
        }
        linkStatus.value = 'connected'
        retryCount.value = 0
        trackEvent('realtime_ws_connected')
        // 推送恢复后不再需要轮询兜底
        stopPolling()
      },
      onEvent: (event) => {
        if (stopped || event.deviceId !== deviceId) {
          return
        }
        // 按 eventId 去重
        if (seenEventIds.includes(event.eventId)) {
          return
        }
        seenEventIds.push(event.eventId)
        if (seenEventIds.length > SEEN_LIMIT) {
          seenEventIds.shift()
        }
        acceptLocation(event.location, 'push')
      },
      onClose: (reason) => {
        stream = null
        if (stopped || reason === 'manual') {
          return
        }
        trackEvent('realtime_ws_disconnected', { reason })
        linkStatus.value = 'reconnecting'
        // 断线期间先靠轮询保证页面数据仍在更新，再指数退避重连
        startPolling()
        scheduleReconnect()
      },
    })
  }

  /**
   * 开始订阅
   * @param id 设备 ID
   * @param currentRecordedAt 首屏快照的采集时间，早于它的事件会被丢弃
   */
  function start(id: string, currentRecordedAt?: string | null) {
    stop()
    deviceId = id
    stopped = false
    retryCount.value = 0
    seenEventIds.length = 0
    latestRecordedAtMs = currentRecordedAt ? new Date(currentRecordedAt).getTime() || 0 : 0
    connect()
  }

  /** 停止订阅并释放所有定时器 */
  function stop() {
    stopped = true
    clearRetryTimer()
    stopPolling()
    if (stream) {
      stream.close()
      stream = null
    }
    linkStatus.value = 'closed'
  }

  /** 手动触发一次链路断开，用于本地验证重连与轮询降级 */
  function simulateDrop() {
    stream?.simulateDrop()
  }

  return {
    linkStatus,
    retryCount,
    start,
    stop,
    simulateDrop,
  }
}
