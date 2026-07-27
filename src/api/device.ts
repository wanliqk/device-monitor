import type {
  DeviceLatestLocationRes,
  DeviceListRes,
  DeviceRuntimeConfig,
  DeviceTrackRes,
} from './types/device'
import { http } from '@/http/http'
import {
  mockGetDeviceList,
  mockGetLatestLocation,
  mockGetRuntimeConfig,
  mockGetTrack,
} from '@/mock/deviceApi'

/**
 * 设备监控业务接口。
 *
 * MVP 阶段服务端尚未就绪，默认走 src/mock 下的伪数据；
 * 后端联调时把 env 里的 VITE_USE_MOCK 置为 'false' 即可切到真实接口，
 * 页面代码不需要任何改动。
 */
export const USE_MOCK_DEVICE_API = import.meta.env.VITE_USE_MOCK !== 'false'

/** 服务端下发的状态阈值与轨迹限制。阈值必须由服务端配置，不能写死在页面 */
export function getDeviceRuntimeConfig() {
  if (USE_MOCK_DEVICE_API) {
    return mockGetRuntimeConfig()
  }
  return http.get<DeviceRuntimeConfig>('/api/v1/devices/config')
}

export interface DeviceListParams {
  /** 按设备名称或编号搜索 */
  keyword?: string
  cursor?: string | null
  limit?: number
}

/** 设备列表。只返回最新状态摘要，不返回历史位置 */
export function getDeviceList(params: DeviceListParams = {}) {
  if (USE_MOCK_DEVICE_API) {
    return mockGetDeviceList(params)
  }
  return http.get<DeviceListRes>('/api/v1/devices', {
    keyword: params.keyword,
    cursor: params.cursor,
    limit: params.limit ?? 20,
  })
}

/** 单设备最新位置快照。进入实时位置页时先用它保证首屏可用 */
export function getDeviceLatestLocation(deviceId: string) {
  if (USE_MOCK_DEVICE_API) {
    return mockGetLatestLocation(deviceId)
  }
  return http.get<DeviceLatestLocationRes>(`/api/v1/devices/${deviceId}/location/latest`)
}

export interface DeviceTrackParams {
  deviceId: string
  /** ISO 8601 UTC */
  startAt: string
  /** ISO 8601 UTC */
  endAt: string
  /** 最大绘制点数，服务端会按该值抽稀 */
  maxPoints?: number
}

/** 历史轨迹。服务端负责裁剪时间范围、过滤异常点并抽稀 */
export function getDeviceTrack(params: DeviceTrackParams) {
  if (USE_MOCK_DEVICE_API) {
    return mockGetTrack(params)
  }
  const { deviceId, ...query } = params
  return http.get<DeviceTrackRes>(`/api/v1/devices/${deviceId}/track`, query)
}
