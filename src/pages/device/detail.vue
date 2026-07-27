<script lang="ts" setup>
import type { DeviceLatestLocationRes, DeviceLocation } from '@/api/types/device'
import { computed, getCurrentInstance, ref } from 'vue'
import { getDeviceLatestLocation } from '@/api/device'
import { useDeviceRealtime } from '@/hooks/useDeviceRealtime'
import { useMapNavigation } from '@/hooks/useMapNavigation'
import { useDeviceConfigStore } from '@/store/deviceConfig'
import {
  formatAccuracy,
  formatBattery,
  formatDateTime,
  formatRelativeTime,
  ONLINE_STATUS_META,
  resolveOnlineStatus,
} from '@/utils/deviceStatus'
import { formatCoordinate, formatSpeed, isValidCoordinate } from '@/utils/geo'
import { trackEvent } from '@/utils/analytics'

defineOptions({
  name: 'DeviceDetail',
})

definePage({
  style: {
    navigationBarTitleText: '设备位置',
  },
})

const configStore = useDeviceConfigStore()
/** openMapApp 依附于页面里的 <map> 组件，需要组件实例来创建地图上下文 */
const instance = getCurrentInstance()
const { navigating, navigateToDevice } = useMapNavigation()

const MAP_ID = 'deviceMap'

const deviceId = ref('')
const snapshot = ref<DeviceLatestLocationRes | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const mapErrorMessage = ref('')
/** 最近一次位置更新的来源，用于向用户说明数据是推送还是轮询拿到的 */
const lastUpdateSource = ref<'snapshot' | 'push' | 'poll'>('snapshot')

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

/** 地图中心。默认跟随设备，用户拖动地图后停止跟随，避免新点到达时把视野拽回去 */
// 郑州测试数据的默认视野。没有定位点时不会挂载原生地图组件。
const center = ref({ latitude: 34.7566, longitude: 113.6500 })
const followDevice = ref(true)
const mapScale = ref(16)
const mapRenderKey = ref(0)

const location = computed(() => snapshot.value?.location ?? null)

/** 微信地图要求服务端下发 gcj02 坐标；无效点不能传给原生 map。 */
function isMapLocation(value: DeviceLocation | null | undefined): value is DeviceLocation {
  return Boolean(
    value
    && value.coordinateSystem === 'gcj02'
    && isValidCoordinate(value.latitude, value.longitude),
  )
}

const validLocation = computed(() => (isMapLocation(location.value) ? location.value : null))
const hasInvalidLocation = computed(() => Boolean(location.value && !validLocation.value))

/** 状态在页面停留期间会自然变旧，必须按当前时间重算 */
const status = computed(() =>
  resolveOnlineStatus(location.value?.recordedAt ?? null, configStore.config.thresholds, now.value),
)
const statusMeta = computed(() => ONLINE_STATUS_META[status.value])

const locationText = computed(() => {
  if (!location.value) {
    return '暂无定位数据'
  }
  if (!validLocation.value) {
    return '定位坐标无效，请检查设备坐标系与定位权限'
  }
  return validLocation.value.address || formatCoordinate(validLocation.value.latitude, validLocation.value.longitude)
})

/** 从未定位的设备不显示 Marker */
const markers = computed(() => {
  if (!validLocation.value) {
    return []
  }
  return [
    {
      id: 1,
      latitude: validLocation.value.latitude,
      longitude: validLocation.value.longitude,
      iconPath: '/static/map/marker-device.png',
      width: 24,
      height: 24,
      anchor: { x: 0.5, y: 0.5 },
      callout: {
        content: `${snapshot.value?.name ?? '设备'}\n${formatRelativeTime(validLocation.value.recordedAt, now.value)}`,
        color: '#333333',
        fontSize: 12,
        borderRadius: 6,
        bgColor: '#FFFFFF',
        padding: 6,
        display: 'BYCLICK' as const,
        textAlign: 'center' as const,
        borderWidth: 0,
        borderColor: '#FFFFFF',
      },
    },
  ]
})

/** 精度圈：只有设备上报了精度才画，避免用固定半径误导用户 */
const circles = computed(() => {
  if (!validLocation.value || !validLocation.value.accuracy) {
    return []
  }
  return [
    {
      latitude: validLocation.value.latitude,
      longitude: validLocation.value.longitude,
      radius: validLocation.value.accuracy,
      color: '#1677FF66',
      fillColor: '#1677FF1A',
      strokeWidth: 1,
    },
  ]
})

const realtime = useDeviceRealtime({
  onLocation: (nextLocation, source) => {
    applyLocation(nextLocation)
    lastUpdateSource.value = source
  },
})

const linkStatusText = computed(() => {
  if (!location.value && status.value === 'never') {
    return ''
  }
  switch (realtime.linkStatus.value) {
    case 'connected':
      return lastUpdateSource.value === 'poll' ? '实时推送已恢复' : '实时推送中'
    case 'connecting':
      return '正在连接实时通道'
    case 'reconnecting':
      return '实时通道重连中，已降级为轮询'
    default:
      return '实时更新已暂停'
  }
})

const linkStatusColor = computed(() => {
  switch (realtime.linkStatus.value) {
    case 'connected':
      return 'text-green-600'
    case 'reconnecting':
      return 'text-orange-500'
    default:
      return 'text-gray-400'
  }
})

function applyLocation(nextLocation: DeviceLocation) {
  if (!snapshot.value) {
    return
  }
  const hadValidLocation = Boolean(validLocation.value)
  const nextLocationIsValid = isMapLocation(nextLocation)
  snapshot.value = { ...snapshot.value, location: nextLocation }
  now.value = Date.now()
  if (followDevice.value && nextLocationIsValid) {
    center.value = { latitude: nextLocation.latitude, longitude: nextLocation.longitude }
  }
  if (nextLocationIsValid) {
    mapErrorMessage.value = ''
  }
  // 某些 iOS/微信版本在 map 首次收到非法坐标后不会可靠恢复，
  // 从无效点切换到有效点时用 key 强制创建一个全新的原生地图实例。
  if (!hadValidLocation && nextLocationIsValid) {
    mapRenderKey.value += 1
  }
}

async function fetchSnapshot(options: { silent?: boolean } = {}) {
  if (!options.silent) {
    loading.value = true
  }
  try {
    const res = await getDeviceLatestLocation(deviceId.value)
    // 防止接口或缓存返回了另一台设备的数据；身份不一致时禁止进入地图渲染流程。
    if (res.deviceId !== deviceId.value) {
      throw new Error('设备数据校验失败，请重试')
    }
    const hadValidLocation = Boolean(validLocation.value)
    const nextLocationIsValid = isMapLocation(res.location)
    snapshot.value = res
    lastUpdateSource.value = 'snapshot'
    errorMessage.value = ''
    now.value = Date.now()
    if (res.location && followDevice.value && nextLocationIsValid) {
      center.value = { latitude: res.location.latitude, longitude: res.location.longitude }
    }
    if (res.location && !nextLocationIsValid) {
      mapErrorMessage.value = '设备返回的坐标无效，已停止地图渲染'
    }
    else {
      mapErrorMessage.value = ''
    }
    if (!hadValidLocation && nextLocationIsValid) {
      mapRenderKey.value += 1
    }
    return res
  }
  catch (error) {
    // 接口失败时保留最后一次成功的快照，并明确标记数据时间，不伪装成实时数据
    errorMessage.value = (error as Error)?.message || '网络异常，请稍后重试'
    return null
  }
  finally {
    loading.value = false
  }
}

function backToDevice() {
  followDevice.value = true
  if (validLocation.value) {
    center.value = { latitude: validLocation.value.latitude, longitude: validLocation.value.longitude }
    mapScale.value = 16
  }
}

/** 原生地图服务异常时显示可理解的业务提示，而不是暴露底层地图画布。 */
function handleMapError() {
  mapErrorMessage.value = '地图服务暂时不可用，请检查网络或地图配置'
}

function retryMap() {
  mapErrorMessage.value = ''
  mapRenderKey.value += 1
}

function handleRegionChange(event: any) {
  // 只有用户手动拖动才取消跟随；缩放和程序化更新不影响
  if (event?.type === 'end' && event?.causedBy === 'drag') {
    followDevice.value = false
  }
}

function startTicker() {
  stopTicker()
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

/** 无有效定位点时禁用导航按钮 */
const canNavigate = computed(() => Boolean(validLocation.value))

function handleNavigate() {
  navigateToDevice({
    mapId: MAP_ID,
    instance: instance?.proxy,
    location: validLocation.value,
    deviceName: snapshot.value?.name ?? '设备位置',
    status: status.value,
  })
}

function goTrack() {
  uni.navigateTo({
    url: `/pages/device/track?deviceId=${deviceId.value}&name=${encodeURIComponent(snapshot.value?.name ?? '')}`,
  })
}

async function refresh() {
  const res = await fetchSnapshot({ silent: true })
  if (res) {
    uni.showToast({ title: '已刷新', icon: 'none' })
  }
}

/** 进入或回到前台：先取快照保证首屏，再恢复实时通道 */
async function resume() {
  if (!deviceId.value) {
    return
  }
  startTicker()
  const res = await fetchSnapshot({ silent: snapshot.value !== null })
  if (res) {
    realtime.start(deviceId.value, res.location?.recordedAt ?? null)
  }
}

onLoad((options) => {
  deviceId.value = options?.deviceId ?? ''
  const name = options?.name ? decodeURIComponent(options.name) : ''
  if (name) {
    uni.setNavigationBarTitle({ title: name })
  }
  configStore.ensureLoaded()

  if (!deviceId.value) {
    loading.value = false
    errorMessage.value = '缺少设备参数'
  }
})

onShow(() => {
  trackEvent('device_detail_view', { hasDeviceId: Boolean(deviceId.value) })
  resume()
})

// 进入后台时停止高频 UI 更新与实时订阅
onHide(() => {
  stopTicker()
  realtime.stop()
})

onUnload(() => {
  stopTicker()
  realtime.stop()
})
</script>

<template>
  <view class="h-screen flex flex-col bg-gray-100">
    <view v-if="loading" class="px-3 pt-3">
      <view class="rounded-3 bg-white px-4 py-4">
        <wd-skeleton :row-col="[{ width: '50%' }, { width: '80%' }, 1, 1]" animation="gradient" />
      </view>
    </view>

    <!-- 设备不存在或无权限时统一提示，不区分两者，避免泄露设备是否存在 -->
    <view v-else-if="errorMessage && !snapshot" class="flex flex-col items-center px-6 py-20">
      <view class="i-carbon-locked text-16 text-gray-300" />
      <view class="mt-4 text-4 text-gray-500">
        {{ errorMessage }}
      </view>
      <view class="mt-6">
        <wd-button size="small" plain @click="resume()">
          重试
        </wd-button>
      </view>
    </view>

    <template v-else>
      <!-- 顶部状态栏 -->
      <view class="flex-shrink-0 bg-white px-4 py-3">
        <view class="flex items-center">
          <view
            class="mr-2 h-2 w-2 flex-shrink-0 rounded-full"
            :style="{ backgroundColor: statusMeta.dotColor }"
          />
          <text class="flex-1 truncate text-4.5 font-medium">
            {{ snapshot?.name }}
          </text>
          <wd-tag :type="statusMeta.tagType" size="small">
            {{ statusMeta.label }}
          </wd-tag>
        </view>
        <view class="mt-1 text-3.5 text-gray-500">
          {{ statusMeta.hint }}
        </view>
        <view v-if="location" class="mt-1 text-3 text-gray-400">
          定位时间 {{ formatDateTime(location.recordedAt) }}（{{ formatRelativeTime(location.recordedAt, now) }}）
        </view>
        <view v-else-if="snapshot?.lastSeenAt" class="mt-1 text-3 text-gray-400">
          最后通信 {{ formatDateTime(snapshot.lastSeenAt) }}（{{ formatRelativeTime(snapshot.lastSeenAt, now) }}）
        </view>
        <view v-if="linkStatusText" class="mt-1 text-3" :class="linkStatusColor">
          {{ linkStatusText }}
        </view>
      </view>

      <view
        v-if="errorMessage"
        class="mx-3 mt-2 flex flex-shrink-0 items-center rounded-2 bg-orange-50 px-3 py-2 text-3 text-orange-600"
      >
        <view class="i-carbon-warning mr-2 flex-shrink-0" />
        <text class="flex-1">
          {{ errorMessage }}，以下为最后一次成功获取的数据
        </text>
      </view>

      <!-- 中部地图 -->
      <!-- 原生 map 在真机首次挂载时不能依赖 flex-1 推导高度，必须给出明确高度。 -->
      <view class="relative mt-2 h-80 w-full flex-shrink-0">
        <map
          v-if="validLocation"
          :id="MAP_ID"
          :key="mapRenderKey"
          class="h-full w-full"
          :latitude="center.latitude"
          :longitude="center.longitude"
          :scale="mapScale"
          :markers="markers"
          :circles="circles"
          :show-location="false"
          @regionchange="handleRegionChange"
          @error="handleMapError"
        />

        <view
          v-if="!validLocation"
          class="absolute inset-0 flex items-center justify-center bg-white/70 px-8 text-center text-3.5 text-gray-500"
        >
          {{ hasInvalidLocation ? '该设备返回的定位坐标无效，地图上不显示位置。' : '该设备没有有效定位点，地图上不显示位置。' }}
          请检查设备定位权限、坐标系与网络连接。
        </view>

        <view
          v-else-if="mapErrorMessage"
          class="absolute inset-0 flex flex-col items-center justify-center bg-white/90 px-8 text-center text-3.5 text-gray-500"
        >
          <view class="i-carbon-warning mb-2 text-8 text-gray-300" />
          <text>{{ mapErrorMessage }}</text>
          <wd-button class="mt-4" size="small" plain @click="retryMap">
            重试地图
          </wd-button>
        </view>

        <view
          v-else-if="validLocation && !followDevice"
          class="absolute bottom-3 right-3 flex items-center rounded-full bg-white px-3 py-2 text-3 shadow"
          @click="backToDevice"
        >
          <view class="i-carbon-location mr-1 text-primary" />
          <text>回到设备位置</text>
        </view>
      </view>

      <!-- 底部信息卡与操作区 -->
      <view class="flex-shrink-0 bg-white px-4 pt-3 pb-safe">
        <view class="flex items-start">
          <view class="i-carbon-location mr-2 mt-1 flex-shrink-0 text-gray-400" />
          <text class="flex-1 text-3.75">
            {{ locationText }}
          </text>
        </view>

        <view v-if="validLocation" class="mt-2 flex flex-wrap text-3 text-gray-500">
          <text class="mr-4">
            经纬度 {{ formatCoordinate(validLocation.latitude, validLocation.longitude, 5) }}
          </text>
          <text class="mr-4">
            速度 {{ formatSpeed(validLocation.speed) }}
          </text>
          <text class="mr-4">
            精度 {{ formatAccuracy(validLocation.accuracy) }}
          </text>
          <text v-if="formatBattery(validLocation.battery) !== '--'">
            电量 {{ formatBattery(validLocation.battery) }}
          </text>
        </view>

        <!-- 主操作：导航到设备。无有效定位点时禁用，位置过期时会先弹风险提示 -->
        <view class="mt-3">
          <wd-button
            type="primary"
            block
            :disabled="!canNavigate"
            :loading="navigating"
            @click="handleNavigate"
          >
            导航到设备
          </wd-button>
        </view>

        <view class="mt-2 flex gap-2">
          <wd-button plain size="small" custom-class="flex-1" @click="goTrack">
            查看轨迹
          </wd-button>
          <wd-button plain size="small" custom-class="flex-1" @click="refresh">
            刷新
          </wd-button>
        </view>
      </view>
    </template>
  </view>
</template>
