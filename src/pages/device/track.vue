<script lang="ts" setup>
import type { DeviceTrackRes, TrackPoint } from '@/api/types/device'
import { computed, ref } from 'vue'
import { getDeviceTrack } from '@/api/device'
import { useDeviceConfigStore } from '@/store/deviceConfig'
import { formatAccuracy, formatDateTime } from '@/utils/deviceStatus'
import { formatCoordinate, formatDistance, formatSpeed } from '@/utils/geo'
import { trackEvent } from '@/utils/analytics'

defineOptions({
  name: 'DeviceTrack',
})

definePage({
  style: {
    navigationBarTitleText: '历史轨迹',
  },
})

type TrackPreset = 'today' | 'yesterday' | 'custom'
type PickerTarget = 'start' | 'end' | null

const configStore = useDeviceConfigStore()
const deviceId = ref('')
const deviceName = ref('设备轨迹')
const preset = ref<TrackPreset>('today')
const customStart = ref(Date.now() - 60 * 60 * 1000)
const customEnd = ref(Date.now())
const pickerTarget = ref<PickerTarget>(null)
const pickerDraft = ref(Date.now())
const pickerVisible = computed(() => pickerTarget.value !== null)
const loading = ref(false)
const queried = ref(false)
const errorMessage = ref('')
const track = ref<DeviceTrackRes | null>(null)
const selectedPoint = ref<TrackPoint | null>(null)

function startOfDay(timestamp: number) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function getPresetRange(value: TrackPreset, now = Date.now()) {
  const today = startOfDay(now)
  if (value === 'yesterday') {
    return { startAt: new Date(today - 24 * 60 * 60 * 1000), endAt: new Date(today) }
  }
  if (value === 'custom') {
    return { startAt: new Date(customStart.value), endAt: new Date(customEnd.value) }
  }
  return { startAt: new Date(today), endAt: new Date(now) }
}

const requestedRange = computed(() => getPresetRange(preset.value))

const requestedRangeText = computed(() => `${formatDateTime(requestedRange.value.startAt.toISOString(), 'MM-DD HH:mm')} - ${formatDateTime(requestedRange.value.endAt.toISOString(), 'MM-DD HH:mm')}`)

const actualRangeText = computed(() => {
  if (!track.value) {
    return requestedRangeText.value
  }
  return `${formatDateTime(track.value.startAt, 'MM-DD HH:mm')} - ${formatDateTime(track.value.endAt, 'MM-DD HH:mm')}`
})

const rangeWasClipped = computed(() => {
  if (!track.value) {
    return false
  }
  return track.value.startAt !== requestedRange.value.startAt.toISOString()
    || track.value.endAt !== requestedRange.value.endAt.toISOString()
})

const center = computed(() => {
  const point = track.value?.endPoint ?? track.value?.startPoint
  return point
    ? { latitude: point.latitude, longitude: point.longitude }
    : { latitude: 31.2304, longitude: 121.4737 }
})

const polyline = computed(() => {
  const points = track.value?.points ?? []
  if (points.length < 2) {
    return []
  }
  return [{
    points: points.map(point => ({ latitude: point.latitude, longitude: point.longitude })),
    color: '#1677FF',
    width: 5,
    arrowLine: true,
    borderColor: '#FFFFFF',
    borderWidth: 1,
  }]
})

/** 只绘制有限数量的关键点 Marker，避免长轨迹创建数千个 Marker 影响地图性能。 */
const keyPoints = computed(() => {
  const points = track.value?.points ?? []
  if (points.length <= 24) {
    return points.map((point, index) => ({ point, index }))
  }
  const step = (points.length - 1) / 23
  const indexes = new Set<number>()
  for (let i = 0; i < 24; i++) {
    indexes.add(Math.round(i * step))
  }
  return Array.from(indexes).sort((a, b) => a - b).map(index => ({ point: points[index], index }))
})

const markers = computed(() => {
  const result: any[] = []
  const start = track.value?.startPoint
  const end = track.value?.endPoint
  if (start) {
    result.push({
      id: 1,
      latitude: start.latitude,
      longitude: start.longitude,
      iconPath: '/static/map/marker-start.png',
      width: 30,
      height: 30,
      anchor: { x: 0.5, y: 1 },
      callout: { content: `起点 ${formatDateTime(start.recordedAt, 'MM-DD HH:mm')}`, display: 'BYCLICK', color: '#333333', fontSize: 11, borderRadius: 4, bgColor: '#FFFFFF', padding: 5 },
    })
  }
  if (end) {
    result.push({
      id: 2,
      latitude: end.latitude,
      longitude: end.longitude,
      iconPath: '/static/map/marker-end.png',
      width: 30,
      height: 30,
      anchor: { x: 0.5, y: 1 },
      callout: { content: `终点 ${formatDateTime(end.recordedAt, 'MM-DD HH:mm')}`, display: 'BYCLICK', color: '#333333', fontSize: 11, borderRadius: 4, bgColor: '#FFFFFF', padding: 5 },
    })
  }
  for (const { point, index } of keyPoints.value) {
    result.push({
      id: 100 + index,
      latitude: point.latitude,
      longitude: point.longitude,
      iconPath: '/static/map/marker-point.png',
      width: 18,
      height: 18,
      anchor: { x: 0.5, y: 0.5 },
      callout: { content: formatDateTime(point.recordedAt, 'HH:mm:ss'), display: 'BYCLICK', color: '#333333', fontSize: 10, borderRadius: 4, bgColor: '#FFFFFF', padding: 4 },
    })
  }
  return result
})

const lastPositionText = computed(() => {
  const point = track.value?.endPoint
  return point ? formatCoordinate(point.latitude, point.longitude, 5) : '--'
})

function selectPreset(next: TrackPreset) {
  preset.value = next
  selectedPoint.value = null
  if (next !== 'custom') {
    queryTrack()
  }
}

function openPicker(target: Exclude<PickerTarget, null>) {
  pickerTarget.value = target
  pickerDraft.value = target === 'start' ? customStart.value : customEnd.value
}

function handlePickerValue(value: number) {
  if (pickerTarget.value === 'start') {
    customStart.value = value
  }
  else if (pickerTarget.value === 'end') {
    customEnd.value = value
  }
}

function closePicker() {
  pickerTarget.value = null
}

function confirmPicker(event: { value: number }) {
  handlePickerValue(event.value)
  closePicker()
}

function handlePickerVisible(value: boolean) {
  if (!value) {
    closePicker()
  }
}

function showPoint(point: TrackPoint) {
  selectedPoint.value = point
}

function handleMarkerTap(event: { detail?: { markerId?: number } }) {
  const markerId = event?.detail?.markerId
  if (typeof markerId !== 'number' || markerId < 100) {
    return
  }
  const index = markerId - 100
  const point = track.value?.points[index]
  if (point) {
    showPoint(point)
  }
}

async function queryTrack() {
  if (!deviceId.value || loading.value) {
    return
  }
  const range = requestedRange.value
  if (range.endAt.getTime() <= range.startAt.getTime()) {
    uni.showToast({ title: '结束时间必须晚于开始时间', icon: 'none' })
    return
  }

  loading.value = true
  errorMessage.value = ''
  selectedPoint.value = null
  try {
    const result = await getDeviceTrack({
      deviceId: deviceId.value,
      startAt: range.startAt.toISOString(),
      endAt: range.endAt.toISOString(),
      maxPoints: configStore.config.maxTrackPoints,
    })
    track.value = result
    queried.value = true
    trackEvent('track_query', {
      success: true,
      pointCount: result.pointCount,
      rawPointCount: result.rawPointCount,
      rangeClipped: result.startAt !== range.startAt.toISOString() || result.endAt !== range.endAt.toISOString(),
    })
    if (rangeWasClipped.value) {
      uni.showToast({ title: '查询范围已按服务端实际范围裁剪', icon: 'none', duration: 2500 })
    }
  }
  catch (error) {
    errorMessage.value = (error as Error)?.message || '网络异常，请稍后重试'
    queried.value = true
    trackEvent('track_query', { success: false })
  }
  finally {
    loading.value = false
  }
}

onLoad((options) => {
  deviceId.value = options?.deviceId ?? ''
  if (options?.name) {
    deviceName.value = decodeURIComponent(options.name)
    uni.setNavigationBarTitle({ title: `${deviceName.value} · 轨迹` })
  }
  configStore.ensureLoaded()
  if (!deviceId.value) {
    errorMessage.value = '缺少设备参数'
    queried.value = true
    return
  }
  queryTrack()
})
</script>

<template>
  <view class="min-h-screen bg-gray-100">
    <view class="bg-white px-3 pt-2">
      <view class="flex rounded-2 bg-gray-100 p-1">
        <view
          v-for="item in ([['today', '今天'], ['yesterday', '昨天'], ['custom', '自定义']] as const)"
          :key="item[0]"
          class="flex-1 rounded-1.5 py-2 text-center text-3.5"
          :class="preset === item[0] ? 'bg-white text-primary shadow-sm' : 'text-gray-500'"
          @click="selectPreset(item[0])"
        >
          {{ item[1] }}
        </view>
      </view>

      <template v-if="preset === 'custom'">
        <view class="mt-2 flex items-center text-3.5">
          <view class="flex-1 rounded-2 bg-gray-50 px-3 py-2" @click="openPicker('start')">
            <text class="block text-3 text-gray-400">开始时间</text>
            <text>{{ formatDateTime(new Date(customStart).toISOString(), 'YYYY-MM-DD HH:mm') }}</text>
          </view>
          <text class="mx-2 text-gray-400">至</text>
          <view class="flex-1 rounded-2 bg-gray-50 px-3 py-2" @click="openPicker('end')">
            <text class="block text-3 text-gray-400">结束时间</text>
            <text>{{ formatDateTime(new Date(customEnd).toISOString(), 'YYYY-MM-DD HH:mm') }}</text>
          </view>
        </view>
        <view class="mt-2 pb-2 text-3 text-gray-400">
          自定义范围超过 24 小时将由服务端裁剪
        </view>
        <wd-button type="primary" block size="small" :loading="loading" @click="queryTrack">
          查询轨迹
        </wd-button>
      </template>
      <view v-else class="h-2" />
    </view>

    <view v-if="loading && !track" class="px-3 pt-3">
      <view class="rounded-3 bg-white px-4 py-4">
        <wd-skeleton :row-col="[1, 1, { width: '60%' }]" animation="gradient" />
      </view>
    </view>

    <template v-else-if="errorMessage && !track">
      <view class="flex flex-col items-center px-6 py-20">
        <view class="i-carbon-warning-alt text-16 text-gray-300" />
        <view class="mt-4 text-center text-4 text-gray-500">
          {{ errorMessage }}
        </view>
        <wd-button class="mt-6" size="small" plain @click="queryTrack">
          重试
        </wd-button>
      </view>
    </template>

    <template v-else-if="track">
      <view class="relative mt-2 h-80 w-full bg-gray-200">
        <map
          class="h-full w-full"
          :latitude="center.latitude"
          :longitude="center.longitude"
          :scale="14"
          :polyline="polyline"
          :markers="markers"
          :enable-zoom="true"
          :enable-scroll="true"
          @markertap="handleMarkerTap"
        />
        <view v-if="track.points.length === 0" class="absolute inset-0 flex items-center justify-center bg-white/75 px-8 text-center text-3.5 text-gray-500">
          当前筛选范围内没有可绘制的轨迹
        </view>
      </view>

      <view class="px-3 py-3">
        <view class="rounded-3 bg-white px-4 py-3">
          <view class="flex items-center">
            <text class="flex-1 text-4 font-medium">{{ deviceName }} · 轨迹摘要</text>
            <text class="text-3 text-gray-400">{{ track.pointCount }} 个绘制点</text>
          </view>
          <view class="grid grid-cols-2 mt-3 gap-y-3 text-3.5">
            <view><text class="text-gray-400">实际范围</text><text class="mt-1 block">{{ actualRangeText }}</text></view>
            <view><text class="text-gray-400">估算里程</text><text class="mt-1 block">{{ formatDistance(track.distanceMeters) }}</text></view>
            <view><text class="text-gray-400">原始有效点</text><text class="mt-1 block">{{ track.rawPointCount }} 个</text></view>
            <view><text class="text-gray-400">最后位置</text><text class="mt-1 block">{{ lastPositionText }}</text></view>
          </view>
          <view class="mt-2 text-3 text-gray-400">
            里程为基于定位点的估算值，不代表道路实际里程
          </view>
          <view v-if="rangeWasClipped" class="mt-2 rounded-1 bg-orange-50 px-2 py-1 text-3 text-orange-600">
            请求范围较大或超出设备数据，已展示服务端实际范围：{{ actualRangeText }}
          </view>
          <view v-if="track.qualityNotes.length" class="mt-2 border-t border-gray-100 pt-2">
            <view v-for="note in track.qualityNotes" :key="note" class="mt-1 flex text-3 text-orange-600">
              <view class="i-carbon-information mr-1 mt-0.5 flex-shrink-0" /><text>{{ note }}</text>
            </view>
          </view>
        </view>

        <view v-if="selectedPoint" class="mt-3 rounded-3 bg-white px-4 py-3">
          <view class="text-3.5 font-medium">
            轨迹点详情
          </view>
          <view class="grid grid-cols-2 mt-2 gap-y-2 text-3.5 text-gray-600">
            <text>时间 {{ formatDateTime(selectedPoint.recordedAt) }}</text>
            <text>速度 {{ formatSpeed(selectedPoint.speed) }}</text>
            <text>精度 {{ formatAccuracy(selectedPoint.accuracy) }}</text>
            <text>坐标 {{ formatCoordinate(selectedPoint.latitude, selectedPoint.longitude, 5) }}</text>
          </view>
        </view>

        <view v-if="queried && track.points.length === 0" class="mt-3 rounded-3 bg-white px-4 py-5 text-center">
          <view class="i-carbon-map text-12 text-gray-300" />
          <view class="mt-2 text-3.75 text-gray-500">
            {{ track.deviceEverReported ? '筛选范围内无轨迹' : '设备从未上报位置' }}
          </view>
          <view class="mt-1 text-3 text-gray-400">
            {{ track.deviceEverReported ? '可以调整时间范围后重新查询' : '设备尚未产生任何有效定位数据' }}
          </view>
        </view>

        <view v-if="errorMessage" class="mt-3 flex items-center rounded-2 bg-red-50 px-3 py-2 text-3.5 text-red-500">
          <view class="i-carbon-warning mr-2 flex-shrink-0" /><text class="flex-1">{{ errorMessage }}</text>
          <text class="ml-2 text-primary" @click="queryTrack">重试</text>
        </view>
      </view>
    </template>

    <wd-datetime-picker
      v-model="pickerDraft"
      type="datetime"
      title="选择时间"
      :visible="pickerVisible"
      :max-date="Date.now()"
      :use-second="false"
      @update:visible="handlePickerVisible"
      @confirm="confirmPicker"
    />
  </view>
</template>
