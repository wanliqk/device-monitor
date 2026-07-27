<script lang="ts" setup>
import type { DeviceStatusThresholds, DeviceSummary } from '@/api/types/device'
import { computed } from 'vue'
import {
  formatBattery,
  formatRelativeTime,
  ONLINE_STATUS_META,
  resolveOnlineStatus,
} from '@/utils/deviceStatus'
import { formatCoordinate } from '@/utils/geo'

const props = defineProps<{
  device: DeviceSummary
  thresholds: DeviceStatusThresholds
  /**
   * 由列表页统一驱动的当前时间戳。
   * 页面停留期间数据会自然变旧，状态必须跟着重算，不能一直用服务端返回的快照状态。
   */
  now: number
}>()

const emit = defineEmits<{
  (event: 'click', device: DeviceSummary): void
}>()

/** 只展示设备编号后四位，避免在列表里暴露完整 IMEI */
const shortId = computed(() => props.device.externalId.slice(-4))

const status = computed(() =>
  resolveOnlineStatus(props.device.location?.recordedAt ?? null, props.thresholds, props.now),
)

const statusMeta = computed(() => ONLINE_STATUS_META[status.value])

/** 有定位点时展示定位时间，从未定位时退回最后通信时间 */
const timeText = computed(() => {
  const location = props.device.location
  if (location) {
    return `定位于 ${formatRelativeTime(location.recordedAt, props.now)}`
  }
  if (props.device.lastSeenAt) {
    return `最后通信 ${formatRelativeTime(props.device.lastSeenAt, props.now)}`
  }
  return '暂无通信记录'
})

/** 逆地理编码失败时降级展示经纬度 */
const locationText = computed(() => {
  const location = props.device.location
  if (!location) {
    return '暂无定位数据'
  }
  return location.address || formatCoordinate(location.latitude, location.longitude)
})

const batteryText = computed(() => formatBattery(props.device.location?.battery))
</script>

<template>
  <view
    class="mb-3 rounded-3 bg-white px-4 py-3 shadow-sm active:bg-gray-50"
    @click="emit('click', device)"
  >
    <view class="flex items-center justify-between">
      <view class="flex-1 truncate text-4 font-medium">
        {{ device.name }}
      </view>
      <wd-tag :type="statusMeta.tagType" size="small">
        {{ statusMeta.label }}
      </wd-tag>
    </view>

    <view class="mt-1 flex items-center text-3 text-gray-400">
      <text>编号 ····{{ shortId }}</text>
      <text class="mx-2">
        ·
      </text>
      <text>{{ timeText }}</text>
    </view>

    <view class="mt-2 flex items-center text-3.5 text-gray-600">
      <view class="i-carbon-location mr-1 flex-shrink-0 text-gray-400" />
      <text class="flex-1 truncate">
        {{ locationText }}
      </text>
    </view>

    <view v-if="batteryText !== '--'" class="mt-1 flex items-center text-3 text-gray-400">
      <view class="i-carbon-battery-full mr-1" />
      <text>电量 {{ batteryText }}</text>
    </view>
  </view>
</template>
