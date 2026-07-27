import type { DeviceRuntimeConfig } from '@/api/types/device'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getDeviceRuntimeConfig } from '@/api/device'
import { DEFAULT_STATUS_THRESHOLDS } from '@/utils/deviceStatus'

/** 服务端配置拉取失败时的兜底值 */
const FALLBACK_CONFIG: DeviceRuntimeConfig = {
  thresholds: DEFAULT_STATUS_THRESHOLDS,
  maxTrackRangeHours: 24,
  maxTrackPoints: 2000,
}

/**
 * 设备监控的运行时配置。
 *
 * 在线状态阈值必须由服务端按设备实际上报周期下发，不能写死在页面；
 * 这里在应用内缓存一份，避免每个页面重复请求。
 */
export const useDeviceConfigStore = defineStore('deviceConfig', () => {
  const config = ref<DeviceRuntimeConfig>({ ...FALLBACK_CONFIG })
  const loaded = ref(false)

  /** 并发调用时复用同一个请求 */
  let pending: Promise<DeviceRuntimeConfig> | null = null

  const ensureLoaded = async () => {
    if (loaded.value) {
      return config.value
    }
    if (!pending) {
      pending = getDeviceRuntimeConfig()
        .then((res) => {
          config.value = res
          loaded.value = true
          return res
        })
        .catch((error) => {
          // 配置拉取失败不阻塞页面，用兜底阈值继续展示，但不标记为已加载，下次进入会重试
          console.warn('[deviceConfig] 拉取运行时配置失败，使用默认阈值', error)
          return config.value
        })
        .finally(() => {
          pending = null
        })
    }
    return pending
  }

  return {
    config,
    loaded,
    ensureLoaded,
  }
})
