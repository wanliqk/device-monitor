import type { DeviceStatusThresholds, DeviceSummary } from '@/api/types/device'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import DeviceCard from './DeviceCard.vue'

const NOW = new Date('2026-07-27T08:00:00Z').getTime()

const thresholds: DeviceStatusThresholds = { onlineSeconds: 60, staleSeconds: 300 }

function isoBefore(seconds: number) {
  return new Date(NOW - seconds * 1000).toISOString()
}

function makeDevice(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    id: 'dev_001',
    externalId: 'IMEI-867295060234871',
    name: '巡检车 沪A·3871',
    status: 'active',
    lastSeenAt: isoBefore(10),
    onlineStatus: 'online',
    location: {
      latitude: 31.230400,
      longitude: 121.473700,
      coordinateSystem: 'gcj02',
      recordedAt: isoBefore(10),
      receivedAt: isoBefore(9),
      accuracy: 12,
      speed: 3.2,
      heading: 80,
      battery: 76,
      address: '上海市黄浦区人民大道 200 号附近',
    },
    ...overrides,
  }
}

function mountCard(device: DeviceSummary, now = NOW) {
  return mount(DeviceCard, {
    props: { device, thresholds, now },
    global: {
      // wd-tag 由 easycom 提供，测试里用桩组件渲染其插槽内容
      stubs: {
        'wd-tag': { template: '<span class="wd-tag-stub"><slot /></span>' },
      },
    },
  })
}

describe('deviceCard', () => {
  let wrapper: ReturnType<typeof mountCard>

  afterEach(() => {
    wrapper?.unmount()
  })

  it('只展示设备编号后四位', () => {
    wrapper = mountCard(makeDevice())
    expect(wrapper.text()).toContain('····4871')
    expect(wrapper.text()).not.toContain('867295060234871')
  })

  it('按当前时间重算在线状态，而不是沿用服务端快照', () => {
    // 服务端下发 online，但本地时间已经过去 10 分钟
    wrapper = mountCard(makeDevice({ onlineStatus: 'online' }), NOW + 600_000)
    expect(wrapper.text()).toContain('离线')
    expect(wrapper.text()).not.toContain('在线')
  })

  it('位置过期区间展示「位置过期」', () => {
    wrapper = mountCard(makeDevice(), NOW + 130_000)
    expect(wrapper.text()).toContain('位置过期')
  })

  it('展示相对定位时间', () => {
    wrapper = mountCard(makeDevice())
    expect(wrapper.text()).toContain('定位于 10 秒前')
  })

  it('有逆地理编码结果时展示地址文案', () => {
    wrapper = mountCard(makeDevice())
    expect(wrapper.text()).toContain('上海市黄浦区人民大道 200 号附近')
  })

  it('逆地理编码失败时降级展示经纬度', () => {
    const device = makeDevice()
    device.location!.address = null
    wrapper = mountCard(device)
    expect(wrapper.text()).toContain('31.230400, 121.473700')
  })

  it('从未定位时展示最后通信时间并提示无定位数据', () => {
    wrapper = mountCard(makeDevice({ location: null, onlineStatus: 'never', lastSeenAt: isoBefore(30) }))
    expect(wrapper.text()).toContain('从未定位')
    expect(wrapper.text()).toContain('最后通信 30 秒前')
    expect(wrapper.text()).toContain('暂无定位数据')
  })

  it('设备不上报电量时不渲染电量行', () => {
    const device = makeDevice()
    device.location!.battery = null
    wrapper = mountCard(device)
    expect(wrapper.text()).not.toContain('电量')
  })

  it('点击卡片抛出 click 事件并带上设备对象', async () => {
    const device = makeDevice()
    wrapper = mountCard(device)
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')?.[0]).toEqual([device])
  })
})
