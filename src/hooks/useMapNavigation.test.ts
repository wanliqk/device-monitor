import type { DeviceLocation } from '@/api/types/device'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAnalyticsReporter } from '@/utils/analytics'
import { useMapNavigation } from './useMapNavigation'

const NOW = new Date('2026-07-27T08:00:00Z').getTime()

function makeLocation(overrides: Partial<DeviceLocation> = {}): DeviceLocation {
  return {
    latitude: 31.2304,
    longitude: 121.4737,
    coordinateSystem: 'gcj02',
    recordedAt: new Date(NOW).toISOString(),
    receivedAt: new Date(NOW).toISOString(),
    accuracy: 12,
    speed: 3.2,
    heading: 80,
    battery: 76,
    address: '上海市黄浦区人民大道 200 号附近',
    ...overrides,
  }
}

/** test-setup.ts 里注入的全局 uni mock */
const uniMock = uni as any

/** 记录埋点事件，验证「不写入完整经纬度」等约束 */
const trackedEvents: Array<{ event: string, payload: Record<string, unknown> }> = []

describe('useMapNavigation', () => {
  beforeEach(() => {
    trackedEvents.length = 0
    setAnalyticsReporter((event, payload) => {
      trackedEvents.push({ event, payload: payload as Record<string, unknown> })
    })
    // 默认：openMapApp 可用且成功
    uniMock.createMapContext = vi.fn(() => ({
      openMapApp: vi.fn((options: any) => options.success?.()),
    }))
    uniMock.openLocation = vi.fn((options: any) => options.success?.())
    uniMock.showModal = vi.fn((options: any) => options.success?.({ confirm: true }))
    uniMock.showToast = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function baseParams(overrides: Record<string, any> = {}) {
    return {
      mapId: 'deviceMap',
      instance: {},
      location: makeLocation(),
      deviceName: '巡检车 沪A·3871',
      status: 'online' as const,
      ...overrides,
    }
  }

  it('在线设备直接拉起地图 App，不弹风险提示', async () => {
    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(baseParams())

    expect(outcome).toBe('opened')
    expect(uniMock.showModal).not.toHaveBeenCalled()
    expect(uniMock.openLocation).not.toHaveBeenCalled()
  })

  it('传给 openMapApp 的是经纬度与设备名，不指定 preferApplication', async () => {
    const openMapApp = vi.fn((options: any) => options.success?.())
    uniMock.createMapContext = vi.fn(() => ({ openMapApp }))

    const { navigateToDevice } = useMapNavigation()
    await navigateToDevice(baseParams())

    const args = openMapApp.mock.calls[0][0] as any
    expect(args.latitude).toBe(31.2304)
    expect(args.longitude).toBe(121.4737)
    expect(args.destination).toBe('巡检车 沪A·3871')
    expect(args.preferApplication).toBeUndefined()
  })

  it('无有效定位点时不发起导航', async () => {
    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(baseParams({ location: null, status: 'never' }))

    expect(outcome).toBe('invalid')
    expect(uniMock.createMapContext).not.toHaveBeenCalled()
    expect(uniMock.showToast).toHaveBeenCalled()
  })

  it('坐标非法时同样拒绝发起', async () => {
    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(
      baseParams({ location: makeLocation({ latitude: 999 }) }),
    )

    expect(outcome).toBe('invalid')
    expect(uniMock.createMapContext).not.toHaveBeenCalled()
  })

  it('位置过期时先弹风险提示，确认后继续导航', async () => {
    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(baseParams({ status: 'stale' }))

    expect(uniMock.showModal).toHaveBeenCalled()
    const modalArgs = uniMock.showModal.mock.calls[0][0]
    expect(modalArgs.content).toContain('最后上报位置')
    expect(outcome).toBe('opened')
  })

  it('离线设备的提示文案说明设备已离线', async () => {
    const { navigateToDevice } = useMapNavigation()
    await navigateToDevice(baseParams({ status: 'offline' }))

    expect(uniMock.showModal.mock.calls[0][0].content).toContain('已离线')
  })

  it('用户在风险提示中取消时不拉起地图', async () => {
    uniMock.showModal = vi.fn((options: any) => options.success?.({ confirm: false, cancel: true }))

    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(baseParams({ status: 'offline' }))

    expect(outcome).toBe('cancelled')
    expect(uniMock.openLocation).not.toHaveBeenCalled()
  })

  it('基础库不支持 openMapApp 时降级到 openLocation', async () => {
    uniMock.createMapContext = vi.fn(() => ({}))

    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(baseParams())

    expect(outcome).toBe('fallback')
    expect(uniMock.openLocation).toHaveBeenCalled()
    expect(trackedEvents.map(item => item.event)).toContain('navigation_open_fallback')
  })

  it('openMapApp 调用失败时降级到 openLocation', async () => {
    uniMock.createMapContext = vi.fn(() => ({
      openMapApp: vi.fn((options: any) => options.fail?.({ errMsg: 'openMapApp:fail' })),
    }))

    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(baseParams())

    expect(outcome).toBe('fallback')
    expect(uniMock.openLocation).toHaveBeenCalled()
  })

  it('降级也失败时返回 failed 并提示用户', async () => {
    uniMock.createMapContext = vi.fn(() => ({}))
    uniMock.openLocation = vi.fn((options: any) => options.fail?.({ errMsg: 'openLocation:fail' }))

    const { navigateToDevice } = useMapNavigation()
    const outcome = await navigateToDevice(baseParams())

    expect(outcome).toBe('failed')
    expect(uniMock.showToast).toHaveBeenCalled()
  })

  it('连续点击只会拉起一次', async () => {
    const { navigateToDevice } = useMapNavigation()
    const first = await navigateToDevice(baseParams())
    const second = await navigateToDevice(baseParams())

    expect(first).toBe('opened')
    expect(second).toBe('invalid')
    expect(uniMock.createMapContext).toHaveBeenCalledTimes(1)
  })

  it('使用点击瞬间的定位快照，弹窗期间的位置变化不影响目的地', async () => {
    const openMapApp = vi.fn((options: any) => options.success?.())
    uniMock.createMapContext = vi.fn(() => ({ openMapApp }))

    const location = makeLocation()
    let resolveModal: (() => void) | null = null
    uniMock.showModal = vi.fn((options: any) => {
      resolveModal = () => options.success?.({ confirm: true })
    })

    const { navigateToDevice } = useMapNavigation()
    const pending = navigateToDevice(baseParams({ location, status: 'stale' }))

    // 弹窗还开着的时候，设备上报了新位置，原对象被就地更新
    location.latitude = 39.9042
    location.longitude = 116.4074
    resolveModal!()
    await pending

    // 导航目的地仍然是点击瞬间的坐标
    expect(openMapApp.mock.calls[0][0].latitude).toBe(31.2304)
  })

  it('埋点不写入经纬度与地址', async () => {
    const { navigateToDevice } = useMapNavigation()
    await navigateToDevice(baseParams())

    expect(trackedEvents.length).toBeGreaterThan(0)
    for (const { payload } of trackedEvents) {
      const keys = Object.keys(payload).map(key => key.toLowerCase())
      expect(keys.some(key => key.includes('lat') || key.includes('lng') || key.includes('address'))).toBe(false)
    }
    expect(trackedEvents.map(item => item.event)).toContain('navigation_click')
    expect(trackedEvents.map(item => item.event)).toContain('navigation_open_success')
  })
})
