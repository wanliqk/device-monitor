/**
 * 设备监控领域模型
 *
 * 字段命名对齐 MVP_DESIGN.md 第 7、8 章：
 * - 时间统一使用 ISO 8601 UTC 字符串，展示时再按用户时区格式化；
 * - 坐标字段必须携带 `coordinateSystem`，禁止只传经纬度；
 * - 小程序只消费服务端换算好的地图坐标（gcj02），不在页面里做坐标转换。
 */

/** 坐标系。设备来源必须明确声明，混用会造成 Marker、轨迹和导航目的地偏移 */
export type CoordinateSystem = 'wgs84' | 'gcj02'

/** 设备启用状态 */
export type DeviceStatus = 'active' | 'disabled'

/**
 * 设备在线状态。由服务端按可配置阈值判定后下发，小程序只做展示，
 * 但本地也保留同样的判定逻辑用于「页面停留期间数据变旧」的实时降级。
 *
 * - `online`：最后上报时间在 onlineSeconds 内
 * - `stale`：超过 onlineSeconds 但未超过 staleSeconds
 * - `offline`：超过 staleSeconds
 * - `never`：没有任何有效定位点
 */
export type DeviceOnlineStatus = 'online' | 'stale' | 'offline' | 'never'

/** 在线状态判定阈值。必须由服务端配置，不同上报周期的设备取值不同 */
export interface DeviceStatusThresholds {
  /** 在线阈值，单位秒 */
  onlineSeconds: number
  /** 位置过期阈值，单位秒；超过即视为离线 */
  staleSeconds: number
}

/** 经纬度对，用于纯几何计算 */
export interface LatLng {
  latitude: number
  longitude: number
}

/** 一个定位点在小程序侧的视图模型 */
export interface DeviceLocation extends LatLng {
  /** 服务端换算后用于地图展示与导航的坐标系，微信地图为 gcj02 */
  coordinateSystem: CoordinateSystem
  /** 设备采集时间 */
  recordedAt: string
  /** 服务端接收时间 */
  receivedAt: string
  /** 定位精度，米；无该字段时为 null */
  accuracy: number | null
  /** 速度，m/s */
  speed: number | null
  /** 方向，0~359 度 */
  heading: number | null
  /** 电量百分比 */
  battery: number | null
  /** 逆地理编码结果；失败时为 null，页面降级展示经纬度 */
  address: string | null
}

/** 设备列表项。列表接口只返回最新状态摘要，不返回历史位置 */
export interface DeviceSummary {
  id: string
  /** 设备平台 ID，列表只展示后四位 */
  externalId: string
  name: string
  status: DeviceStatus
  /** 最后通信时间，可能晚于最后定位时间（通信正常但定位失败） */
  lastSeenAt: string | null
  onlineStatus: DeviceOnlineStatus
  /** 最新定位点；从未定位的设备为 null */
  location: DeviceLocation | null
}

/** `GET /api/v1/devices` 响应 */
export interface DeviceListRes {
  items: DeviceSummary[]
  /** 游标分页，null 表示没有下一页 */
  nextCursor: string | null
}

/** `GET /api/v1/devices/{deviceId}/location/latest` 响应 */
export interface DeviceLatestLocationRes {
  deviceId: string
  name: string
  status: DeviceOnlineStatus
  lastSeenAt: string | null
  location: DeviceLocation | null
}

/** 轨迹绘制点 */
export interface TrackPoint extends LatLng {
  recordedAt: string
  speed: number | null
  accuracy: number | null
}

/** `GET /api/v1/devices/{deviceId}/track` 响应 */
export interface DeviceTrackRes {
  deviceId: string
  /** 服务端实际查询的时间范围，可能被 24 小时上限裁剪 */
  startAt: string
  endAt: string
  /** 抽稀前的原始有效点数量，里程按它计算 */
  rawPointCount: number
  /** 实际返回的绘制点数量 */
  pointCount: number
  points: TrackPoint[]
  startPoint: TrackPoint | null
  endPoint: TrackPoint | null
  /** 估算里程，米。MVP 不做道路纠偏 */
  distanceMeters: number
  /** 该设备是否有过任何上报，用于区分「设备未上报」和「筛选范围内无轨迹」 */
  deviceEverReported: boolean
  /** 数据质量提示，如「已过滤 3 个低精度点」 */
  qualityNotes: string[]
}

/** WebSocket `location.updated` 事件 */
export interface LocationUpdatedEvent {
  type: 'location.updated'
  /** 客户端按此字段去重 */
  eventId: string
  deviceId: string
  location: DeviceLocation
}

/** 服务端下发的运行时配置 */
export interface DeviceRuntimeConfig {
  thresholds: DeviceStatusThresholds
  /** 自定义时间范围的最大跨度，小时 */
  maxTrackRangeHours: number
  /** 单次轨迹查询返回的最大绘制点数 */
  maxTrackPoints: number
}
