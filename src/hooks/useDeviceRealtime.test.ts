import type { LocationStream, LocationStreamHandlers } from '@/api/deviceSocket'
import type { DeviceLatestLocationRes, DeviceLocation } from '@/api/types/device'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeviceRealtime } from './useDeviceRealtime'

const NOW = new Date('2026-07-27T08:00:00Z').getTime()

function makeLocation(offsetSeconds: number): DeviceLocation {
  const recordedAt = new Date(NOW + offsetSeconds * 1000).toISOString()
  return {
    latitude: 31.2304 + offsetSeconds * 0.0001,
    longitude: 121.4737,
    coordinateSystem: 'gcj02',
    recordedAt,
    receivedAt: recordedAt,
    accuracy: 12,
    speed: 3.2,
    heading: 80,
    battery: 76,
    address: null,
  }
}

/** 可手动驱动的假通道，替代真实 WSS 与 mock 推送 */
function createFakeStream() {
  const streams: Array<{
    handlers: LocationStreamHandlers
    closed: boolean
  }> = []

  const openStream = (deviceId: string, handlers: LocationStreamHandlers): LocationStream => {
    const entry = { handlers, closed: false }
    streams.push(entry)
    return {
      close: () => {
        entry.closed = true
        handlers.onClose?.('manual')
      },
      simulateDrop: () => {
        entry.closed = true
        handlers.onClose?.('dropped')
      },
    }
  }

  return {
    openStream,
    streams,
    get current() {
      return streams[streams.length - 1]
    },
    /** 打开次数，用于断言重连行为 */
    get openCount() {
      return streams.length
    },
  }
}

describe('useDeviceRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('连接成功后状态变为 connected', () => {
    const fake = createFakeStream()
    const realtime = useDeviceRealtime({ onLocation: vi.fn(), openStream: fake.openStream })

    realtime.start('dev_001')
    expect(realtime.linkStatus.value).toBe('connecting')

    fake.current.handlers.onOpen?.()
    expect(realtime.linkStatus.value).toBe('connected')
  })

  it('推送新位置时回调，并标记来源为 push', () => {
    const fake = createFakeStream()
    const onLocation = vi.fn()
    const realtime = useDeviceRealtime({ onLocation, openStream: fake.openStream })

    realtime.start('dev_001')
    fake.current.handlers.onOpen?.()
    fake.current.handlers.onEvent?.({
      type: 'location.updated',
      eventId: 'evt_1',
      deviceId: 'dev_001',
      location: makeLocation(10),
    })

    expect(onLocation).toHaveBeenCalledTimes(1)
    expect(onLocation.mock.calls[0][1]).toBe('push')
  })

  it('相同 eventId 的重复事件只处理一次', () => {
    const fake = createFakeStream()
    const onLocation = vi.fn()
    const realtime = useDeviceRealtime({ onLocation, openStream: fake.openStream })

    realtime.start('dev_001')
    fake.current.handlers.onOpen?.()
    const event = {
      type: 'location.updated' as const,
      eventId: 'evt_1',
      deviceId: 'dev_001',
      location: makeLocation(10),
    }
    fake.current.handlers.onEvent?.(event)
    fake.current.handlers.onEvent?.(event)

    expect(onLocation).toHaveBeenCalledTimes(1)
  })

  it('忽略时间早于当前快照的乱序事件', () => {
    const fake = createFakeStream()
    const onLocation = vi.fn()
    const realtime = useDeviceRealtime({ onLocation, openStream: fake.openStream })

    // 首屏快照的采集时间为 NOW+30s
    realtime.start('dev_001', new Date(NOW + 30_000).toISOString())
    fake.current.handlers.onOpen?.()

    // 更旧的点被丢弃
    fake.current.handlers.onEvent?.({
      type: 'location.updated',
      eventId: 'evt_old',
      deviceId: 'dev_001',
      location: makeLocation(10),
    })
    expect(onLocation).not.toHaveBeenCalled()

    // 更新的点被接受
    fake.current.handlers.onEvent?.({
      type: 'location.updated',
      eventId: 'evt_new',
      deviceId: 'dev_001',
      location: makeLocation(40),
    })
    expect(onLocation).toHaveBeenCalledTimes(1)
  })

  it('忽略其他设备的事件', () => {
    const fake = createFakeStream()
    const onLocation = vi.fn()
    const realtime = useDeviceRealtime({ onLocation, openStream: fake.openStream })

    realtime.start('dev_001')
    fake.current.handlers.onOpen?.()
    fake.current.handlers.onEvent?.({
      type: 'location.updated',
      eventId: 'evt_x',
      deviceId: 'dev_999',
      location: makeLocation(10),
    })

    expect(onLocation).not.toHaveBeenCalled()
  })

  it('链路断开后立即轮询一次，并按 15 秒周期继续轮询', async () => {
    const fake = createFakeStream()
    const onLocation = vi.fn()
    const fetchLatest = vi.fn(async (): Promise<DeviceLatestLocationRes> => ({
      deviceId: 'dev_001',
      name: '巡检车',
      status: 'online',
      lastSeenAt: null,
      location: makeLocation(20),
    }))

    const realtime = useDeviceRealtime({
      onLocation,
      openStream: fake.openStream,
      fetchLatest,
    })

    realtime.start('dev_001')
    fake.current.handlers.onOpen?.()
    realtime.simulateDrop()

    expect(realtime.linkStatus.value).toBe('reconnecting')
    expect(fetchLatest).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchLatest).toHaveBeenCalledTimes(2)

    realtime.stop()
  })

  it('重连采用指数退避：1s、2s、4s', async () => {
    const fake = createFakeStream()
    const realtime = useDeviceRealtime({
      onLocation: vi.fn(),
      openStream: fake.openStream,
      fetchLatest: vi.fn(async () => ({
        deviceId: 'dev_001',
        name: '巡检车',
        status: 'online' as const,
        lastSeenAt: null,
        location: null,
      })),
    })

    realtime.start('dev_001')
    expect(fake.openCount).toBe(1)

    // 第 1 次断开：1 秒后重连
    realtime.simulateDrop()
    await vi.advanceTimersByTimeAsync(999)
    expect(fake.openCount).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.openCount).toBe(2)
    expect(realtime.linkStatus.value).toBe('reconnecting')

    // 第 2 次断开：2 秒后重连
    realtime.simulateDrop()
    await vi.advanceTimersByTimeAsync(1999)
    expect(fake.openCount).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.openCount).toBe(3)

    // 第 3 次断开：4 秒后重连
    realtime.simulateDrop()
    await vi.advanceTimersByTimeAsync(4000)
    expect(fake.openCount).toBe(4)

    realtime.stop()
  })

  it('重连成功后清零退避计数并停止轮询', async () => {
    const fake = createFakeStream()
    const fetchLatest = vi.fn(async () => ({
      deviceId: 'dev_001',
      name: '巡检车',
      status: 'online' as const,
      lastSeenAt: null,
      location: null,
    }))
    const realtime = useDeviceRealtime({
      onLocation: vi.fn(),
      openStream: fake.openStream,
      fetchLatest,
    })

    realtime.start('dev_001')
    realtime.simulateDrop()
    await vi.advanceTimersByTimeAsync(1000)
    fake.current.handlers.onOpen?.()

    expect(realtime.linkStatus.value).toBe('connected')
    expect(realtime.retryCount.value).toBe(0)

    const callsAfterReconnect = fetchLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    // 推送恢复后不应再轮询
    expect(fetchLatest).toHaveBeenCalledTimes(callsAfterReconnect)

    realtime.stop()
  })

  it('stop 后不再重连、不再轮询，状态为 closed', async () => {
    const fake = createFakeStream()
    const fetchLatest = vi.fn(async () => ({
      deviceId: 'dev_001',
      name: '巡检车',
      status: 'online' as const,
      lastSeenAt: null,
      location: null,
    }))
    const realtime = useDeviceRealtime({
      onLocation: vi.fn(),
      openStream: fake.openStream,
      fetchLatest,
    })

    realtime.start('dev_001')
    realtime.simulateDrop()
    realtime.stop()

    const openCountAtStop = fake.openCount
    const pollCountAtStop = fetchLatest.mock.calls.length

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.openCount).toBe(openCountAtStop)
    expect(fetchLatest).toHaveBeenCalledTimes(pollCountAtStop)
    expect(realtime.linkStatus.value).toBe('closed')
  })

  it('主动关闭不会触发重连', async () => {
    const fake = createFakeStream()
    const realtime = useDeviceRealtime({ onLocation: vi.fn(), openStream: fake.openStream })

    realtime.start('dev_001')
    fake.current.handlers.onOpen?.()
    realtime.stop()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.openCount).toBe(1)
  })

  it('重新 start 会先关闭旧连接', () => {
    const fake = createFakeStream()
    const realtime = useDeviceRealtime({ onLocation: vi.fn(), openStream: fake.openStream })

    realtime.start('dev_001')
    realtime.start('dev_002')

    expect(fake.streams[0].closed).toBe(true)
    expect(fake.openCount).toBe(2)

    realtime.stop()
  })
})
