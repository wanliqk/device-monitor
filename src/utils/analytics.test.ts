import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanitizePayload, setAnalyticsReporter, trackEvent } from './analytics'

describe('sanitizePayload', () => {
  it('保留非敏感字段', () => {
    expect(sanitizePayload({ deviceCount: 3, success: true, source: 'push' }))
      .toEqual({ deviceCount: 3, success: true, source: 'push' })
  })

  it('丢弃经纬度字段', () => {
    expect(sanitizePayload({ latitude: 31.2304, longitude: 121.4737, ok: 1 }))
      .toEqual({ ok: 1 })
  })

  it('丢弃经纬度的各种简写与嵌套命名', () => {
    const result = sanitizePayload({
      lat: 31,
      lng: 121,
      lon: 121,
      deviceLatitude: 31,
      coordinate: '31,121',
      keep: 'yes',
    })
    expect(result).toEqual({ keep: 'yes' })
  })

  it('丢弃地址、令牌与 openid', () => {
    expect(sanitizePayload({ address: '上海市…', accessToken: 'x', openid: 'y', z: 1 }))
      .toEqual({ z: 1 })
  })

  it('空入参返回空对象', () => {
    expect(sanitizePayload()).toEqual({})
  })
})

describe('trackEvent', () => {
  afterEach(() => {
    // 还原默认上报实现，避免影响其他用例
    setAnalyticsReporter((event, payload) => {
      console.info('[analytics]', event, payload)
    })
  })

  it('把清洗后的载荷交给上报实现', () => {
    const reporter = vi.fn()
    setAnalyticsReporter(reporter)

    trackEvent('navigation_click', { status: 'online', latitude: 31.2304 })

    expect(reporter).toHaveBeenCalledWith('navigation_click', { status: 'online' })
  })

  it('上报实现抛错时不影响业务流程', () => {
    setAnalyticsReporter(() => {
      throw new Error('reporter down')
    })

    expect(() => trackEvent('device_list_view')).not.toThrow()
  })
})
