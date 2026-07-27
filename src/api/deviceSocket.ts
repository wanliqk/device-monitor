import type { LocationUpdatedEvent } from './types/device'
import { openMockLocationStream } from '@/mock/deviceApi'
import { useTokenStore } from '@/store/token'
import { getEnvBaseUrl } from '@/utils'
import { USE_MOCK_DEVICE_API } from './device'

/**
 * 设备位置实时通道。
 *
 * 对页面暴露统一的句柄，内部按 VITE_USE_MOCK 在「伪数据推送」和「真实 WSS」之间切换。
 * 无论哪种实现，语义都一致：连接成功回调、位置事件回调、关闭回调（区分主动关闭与链路断开）。
 */
export interface LocationStream {
  /** 主动关闭，页面卸载时必须调用 */
  close: () => void
  /** 模拟链路断开，仅用于本地验证重连与轮询降级 */
  simulateDrop: () => void
}

export interface LocationStreamHandlers {
  onOpen?: () => void
  onEvent?: (event: LocationUpdatedEvent) => void
  /** `manual` 表示页面主动关闭，`dropped` 表示链路异常断开，需要触发重连 */
  onClose?: (reason: 'manual' | 'dropped') => void
}

/** 由 HTTPS 基址推导 WSS 基址 */
function resolveWsBaseUrl() {
  const baseUrl = getEnvBaseUrl() || ''
  return baseUrl.replace(/^http/, 'ws')
}

function openRealLocationStream(deviceId: string, handlers: LocationStreamHandlers): LocationStream {
  const tokenStore = useTokenStore()
  const token = tokenStore.updateNowTime().validToken
  let manuallyClosed = false

  const socket = uni.connectSocket({
    // 令牌短期有效，放在 query 里由服务端在握手阶段校验
    url: `${resolveWsBaseUrl()}/ws/v1?token=${encodeURIComponent(token || '')}`,
    complete: () => {},
  })

  socket.onOpen(() => {
    handlers.onOpen?.()
    // 服务端会在订阅时再次校验用户与设备的授权关系
    socket.send({
      data: JSON.stringify({
        type: 'device.subscribe',
        requestId: `req_${Date.now()}`,
        deviceId,
      }),
      fail: () => {},
    })
  })

  socket.onMessage((message) => {
    try {
      const payload = JSON.parse(message.data as string)
      if (payload?.type === 'location.updated') {
        handlers.onEvent?.(payload as LocationUpdatedEvent)
      }
    }
    catch (error) {
      console.warn('[deviceSocket] 消息解析失败', error)
    }
  })

  socket.onError(() => {
    if (!manuallyClosed) {
      handlers.onClose?.('dropped')
    }
  })

  socket.onClose(() => {
    handlers.onClose?.(manuallyClosed ? 'manual' : 'dropped')
  })

  return {
    close: () => {
      manuallyClosed = true
      socket.close({ code: 1000, reason: 'page unload' })
    },
    simulateDrop: () => {
      socket.close({ code: 4000, reason: 'simulated drop' })
    },
  }
}

/** 打开设备位置实时通道 */
export function openLocationStream(deviceId: string, handlers: LocationStreamHandlers): LocationStream {
  if (USE_MOCK_DEVICE_API) {
    return openMockLocationStream(deviceId, handlers)
  }
  return openRealLocationStream(deviceId, handlers)
}
