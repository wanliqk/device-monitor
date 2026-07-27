import type { DeviceLocation, DeviceOnlineStatus } from '@/api/types/device'
import { ref } from 'vue'
import { formatDateTime, needsStaleNavigationWarning } from '@/utils/deviceStatus'
import { isValidCoordinate } from '@/utils/geo'
import { trackEvent } from '@/utils/analytics'

/**
 * 一次导航尝试的结果
 *
 * - `opened`：成功拉起地图 App 选择面板
 * - `fallback`：openMapApp 不可用或失败，已降级到 uni.openLocation
 * - `cancelled`：用户在风险提示弹窗中取消
 * - `invalid`：无有效定位点或重复点击，未发起
 * - `failed`：降级也失败
 */
export type NavigationOutcome = 'opened' | 'fallback' | 'cancelled' | 'invalid' | 'failed'

export interface NavigateToDeviceParams {
  /** 页面中 `<map>` 组件的 id，openMapApp 必须依附于地图上下文 */
  mapId: string
  /** 创建地图上下文所需的组件实例 */
  instance: any
  /** 点击瞬间的定位快照。弹窗期间数据可能变化，必须用快照，避免文案与坐标不一致 */
  location: DeviceLocation | null
  deviceName: string
  /** 当前在线状态，用于决定是否弹风险提示 */
  status: DeviceOnlineStatus
}

/** 连续点击的保护间隔，毫秒 */
const CLICK_GUARD_MS = 2000

/**
 * 「导航到设备」能力。
 *
 * 对齐 MVP 第 9 章：
 * - 只能由用户主动点击触发；
 * - 位置过期或离线时，先说明「将导航到最后上报位置」并给出具体时间；
 * - 目的地使用点击瞬间的定位快照；
 * - `MapContext.openMapApp` 不支持 Promise，必须用 success/fail/complete 回调；
 * - 低版本基础库或拉起失败时降级到 `uni.openLocation`；
 * - 短时间内禁止重复拉起；
 * - 上报匿名事件，且不写入完整经纬度。
 */
export function useMapNavigation() {
  /** 是否正在拉起，用于禁用按钮 */
  const navigating = ref(false)
  let lastClickAt = 0

  function openExternalMap(params: {
    mapId: string
    instance: any
    location: DeviceLocation
    deviceName: string
  }): Promise<NavigationOutcome> {
    return new Promise((resolve) => {
      const { latitude, longitude } = params.location

      const fallback = () => {
        uni.openLocation({
          latitude,
          longitude,
          name: params.deviceName,
          address: params.location.address || '设备最后上报位置',
          scale: 16,
          success: () => {
            trackEvent('navigation_open_fallback', { deviceName: params.deviceName })
            resolve('fallback')
          },
          fail: () => {
            trackEvent('navigation_open_fail', { reason: 'openLocation_failed' })
            uni.showToast({ title: '打开地图失败，请稍后重试', icon: 'none' })
            resolve('failed')
          },
        })
      }

      const mapContext = uni.createMapContext(params.mapId, params.instance) as any

      // 基础库 2.14.0 以下没有该方法，直接降级
      if (!mapContext || typeof mapContext.openMapApp !== 'function') {
        trackEvent('navigation_open_fail', { reason: 'openMapApp_unavailable' })
        fallback()
        return
      }

      // 官方文档明确 openMapApp 不支持 Promise 风格，只能用回调
      mapContext.openMapApp({
        latitude,
        longitude,
        // 不指定 preferApplication，交给系统和用户选择已安装的地图
        destination: params.deviceName,
        success: () => {
          trackEvent('navigation_open_success', { deviceName: params.deviceName })
          resolve('opened')
        },
        fail: () => {
          trackEvent('navigation_open_fail', { reason: 'openMapApp_failed' })
          fallback()
        },
      })
    })
  }

  /** 位置已过期时的风险提示。用户确认后才继续 */
  function confirmStaleLocation(location: DeviceLocation, status: DeviceOnlineStatus): Promise<boolean> {
    return new Promise((resolve) => {
      uni.showModal({
        title: '位置可能已过期',
        content: `该设备${status === 'offline' ? '已离线' : '位置未按预期更新'}，将导航到最后上报位置（${formatDateTime(location.recordedAt, 'MM-DD HH:mm:ss')}）。`,
        confirmText: '继续导航',
        cancelText: '取消',
        success: res => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      })
    })
  }

  async function navigateToDevice(params: NavigateToDeviceParams): Promise<NavigationOutcome> {
    // 防连点：短时间内的重复点击直接忽略，避免连续拉起地图 App
    const now = Date.now()
    if (navigating.value || now - lastClickAt < CLICK_GUARD_MS) {
      return 'invalid'
    }
    lastClickAt = now

    // 点击瞬间冻结定位快照，弹窗期间的位置更新不影响本次导航目的地
    const snapshot = params.location ? { ...params.location } : null

    trackEvent('navigation_click', {
      deviceName: params.deviceName,
      status: params.status,
      hasLocation: Boolean(snapshot),
    })

    if (!snapshot || !isValidCoordinate(snapshot.latitude, snapshot.longitude)) {
      uni.showToast({ title: '暂无有效设备位置', icon: 'none' })
      trackEvent('navigation_open_fail', { reason: 'invalid_location' })
      return 'invalid'
    }

    navigating.value = true
    try {
      if (needsStaleNavigationWarning(params.status)) {
        const confirmed = await confirmStaleLocation(snapshot, params.status)
        if (!confirmed) {
          return 'cancelled'
        }
      }

      return await openExternalMap({
        mapId: params.mapId,
        instance: params.instance,
        location: snapshot,
        deviceName: params.deviceName,
      })
    }
    finally {
      navigating.value = false
    }
  }

  return {
    navigating,
    navigateToDevice,
  }
}
