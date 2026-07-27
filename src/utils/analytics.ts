/**
 * 产品埋点。
 *
 * 只记录必要的产品事件，用于衡量 MVP 成功标准（核心链路成功率、导航拉起成功率、实时链路质量）。
 * 严禁写入完整经纬度、详细地址和访问令牌 —— 位置轨迹属于高敏感数据，
 * 埋点日志的存储与访问控制通常弱于业务库，一旦写入就等于扩大了泄露面。
 */

export type AnalyticsEvent
  = | 'device_list_view'
    | 'device_detail_view'
    | 'track_query'
    | 'navigation_click'
    | 'navigation_open_success'
    | 'navigation_open_fail'
    | 'navigation_open_fallback'
    | 'realtime_ws_connected'
    | 'realtime_ws_disconnected'

export type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>

/** 禁止出现在埋点里的字段名（小写匹配，含部分匹配） */
const FORBIDDEN_KEY_PATTERNS = [
  'latitude',
  'longitude',
  'lat',
  'lng',
  'lon',
  'coordinate',
  'address',
  'token',
  'openid',
]

function isForbiddenKey(key: string) {
  const lower = key.toLowerCase()
  return FORBIDDEN_KEY_PATTERNS.some(pattern => lower.includes(pattern))
}

/**
 * 剔除敏感字段。
 * 这里做成硬性拦截而不是约定，避免后续有人顺手把定位点塞进埋点。
 */
export function sanitizePayload(payload: AnalyticsPayload = {}): AnalyticsPayload {
  const result: AnalyticsPayload = {}
  for (const [key, value] of Object.entries(payload)) {
    if (isForbiddenKey(key)) {
      console.warn(`[analytics] 已丢弃敏感字段: ${key}`)
      continue
    }
    result[key] = value
  }
  return result
}

export type AnalyticsReporter = (event: AnalyticsEvent, payload: AnalyticsPayload) => void

/** 默认上报实现：MVP 阶段只落本地日志，接入真实数据平台时替换即可 */
let reporter: AnalyticsReporter = (event, payload) => {
  console.info('[analytics]', event, payload)
}

/** 替换上报实现（如接入自建埋点服务或微信自定义分析） */
export function setAnalyticsReporter(next: AnalyticsReporter) {
  reporter = next
}

/** 上报一个产品事件 */
export function trackEvent(event: AnalyticsEvent, payload: AnalyticsPayload = {}) {
  try {
    reporter(event, sanitizePayload(payload))
  }
  catch (error) {
    // 埋点失败绝不能影响业务流程
    console.warn('[analytics] 上报失败', error)
  }
}
