import type { LatLng } from '@/api/types/device'

/**
 * 设备运动模式
 * - `moving`：沿预设路线循环行驶
 * - `idle`：停在原地，只有 GPS 漂移
 * - `none`：从未产生过定位点
 */
export type MockMotion = 'moving' | 'idle' | 'none'

/**
 * 伪数据设备档案。
 *
 * 位置由「档案 + 时间戳」纯函数推导，不保存可变状态，
 * 因此同一时刻多次查询结果一致，刷新页面也不会出现位置跳变。
 */
export interface MockDeviceProfile {
  id: string
  externalId: string
  name: string
  status: 'active' | 'disabled'
  motion: MockMotion
  /**
   * 最后上报时间相对当前时间的固定滞后，秒。
   * 0 表示持续实时上报；用于构造「位置过期」「离线」两种状态。
   */
  reportLagSeconds: number
  /** 上报周期，秒。位置时间戳按该周期对齐 */
  reportIntervalSeconds: number
  /** 行驶路线，首尾自动闭合成环 */
  route: LatLng[]
  /** 行驶速度，m/s */
  speedMps: number
  /** 逆地理编码文案池。为空数组时模拟逆地理编码失败，页面应降级展示经纬度 */
  addressPool: string[]
  /** 设备是否上报电量 */
  hasBattery: boolean
}

/** 郑州市区若干参考点（gcj02，与微信地图同坐标系） */
const ZHENGZHOU = {
  erqiSquare: { latitude: 34.7566, longitude: 113.6500 },
  peoplePark: { latitude: 34.7674, longitude: 113.6753 },
  henanMuseum: { latitude: 34.7780, longitude: 113.6880 },
  cbd: { latitude: 34.7668, longitude: 113.7168 },
  erqiTower: { latitude: 34.7555, longitude: 113.6496 },
  eastRailwayStation: { latitude: 34.7592, longitude: 113.7250 },
  zhengzhouUniversity: { latitude: 34.8160, longitude: 113.5370 },
  wulongkou: { latitude: 34.7940, longitude: 113.6740 },
  airport: { latitude: 34.5197, longitude: 113.8408 },
} satisfies Record<string, LatLng>

/**
 * MVP 演示用设备清单，覆盖全部四种在线状态与两种数据缺失场景：
 * - dev_001 在线且移动，含低精度点与跳点，用于验证轨迹质量提示
 * - dev_002 在线但静止，无逆地理编码结果，用于验证经纬度降级展示
 * - dev_003 位置过期（滞后 130 秒）
 * - dev_004 离线（滞后 3 小时）且不上报电量
 * - dev_005 从未定位，但通信正常，用于验证 lastSeenAt 与定位时间的区别
 */
export const MOCK_DEVICE_PROFILES: MockDeviceProfile[] = [
  {
    id: 'dev_001',
    externalId: 'IMEI-867295060234871',
    name: '巡检车 豫A·3871',
    status: 'active',
    motion: 'moving',
    reportLagSeconds: 0,
    reportIntervalSeconds: 10,
    route: [
      ZHENGZHOU.erqiSquare,
      ZHENGZHOU.peoplePark,
      ZHENGZHOU.henanMuseum,
      ZHENGZHOU.cbd,
      ZHENGZHOU.erqiTower,
    ],
    speedMps: 9,
    addressPool: [
      '郑州市二七区解放路 200 号附近',
      '郑州市金水区人民路 300 号附近',
      '郑州市金水区农业路 12 号附近',
      '郑州市金水区商务外环路 132 号附近',
      '郑州市二七区民主路 181 号附近',
    ],
    hasBattery: true,
  },
  {
    id: 'dev_002',
    externalId: 'IMEI-867295060119204',
    name: '冷链车 豫A·9204',
    status: 'active',
    motion: 'idle',
    reportLagSeconds: 0,
    reportIntervalSeconds: 30,
    route: [ZHENGZHOU.eastRailwayStation],
    speedMps: 0,
    // 空文案池：模拟逆地理编码失败，页面必须降级为经纬度展示
    addressPool: [],
    hasBattery: true,
  },
  {
    id: 'dev_003',
    externalId: 'IMEI-867295060557713',
    name: '外勤终端 徐汇 07',
    status: 'active',
    motion: 'moving',
    // 130 秒前的最后上报，落在 60~300 秒区间，判定为「位置过期」
    reportLagSeconds: 130,
    reportIntervalSeconds: 30,
    route: [ZHENGZHOU.zhengzhouUniversity, ZHENGZHOU.wulongkou],
    speedMps: 1.4,
    addressPool: [
      '郑州市中原区建设西路 100 号附近',
      '郑州市中原区桐柏路 1954 号附近',
    ],
    hasBattery: true,
  },
  {
    id: 'dev_004',
    externalId: 'IMEI-867295060338452',
    name: '资产标签 HQ-8452',
    status: 'active',
    motion: 'idle',
    // 3 小时前的最后上报，判定为「离线」
    reportLagSeconds: 3 * 3600,
    reportIntervalSeconds: 300,
    route: [ZHENGZHOU.airport],
    speedMps: 0,
    addressPool: ['郑州市航空港区迎宾大道 1500 号附近'],
    // 该型号不上报电量，页面对应字段应显示占位符而不是 0%
    hasBattery: false,
  },
  {
    id: 'dev_005',
    externalId: 'IMEI-867295060772360',
    name: '新装设备 待激活 2360',
    status: 'active',
    motion: 'none',
    reportLagSeconds: 0,
    reportIntervalSeconds: 60,
    route: [],
    speedMps: 0,
    addressPool: [],
    hasBattery: true,
  },
]

/** 按设备 ID 查档案，找不到返回 undefined（调用方需按「资源不可见」处理） */
export function findMockProfile(deviceId: string): MockDeviceProfile | undefined {
  return MOCK_DEVICE_PROFILES.find(profile => profile.id === deviceId)
}
