<script lang="ts" setup>
import type { DeviceLatestLocationRes } from '@/api/types/device'
import { computed, ref } from 'vue'
import { getDeviceLatestLocation } from '@/api/device'
import { useDeviceConfigStore } from '@/store/deviceConfig'
import {
  formatAccuracy,
  formatBattery,
  formatDateTime,
  formatRelativeTime,
  ONLINE_STATUS_META,
  resolveOnlineStatus,
} from '@/utils/deviceStatus'
import { formatCoordinate, formatSpeed } from '@/utils/geo'

defineOptions({
  name: 'DeviceDetail',
})

definePage({
  style: {
    navigationBarTitleText: '设备位置',
  },
})

const configStore = useDeviceConfigStore()

const deviceId = ref('')
const snapshot = ref<DeviceLatestLocationRes | null>(null)
const loading = ref(true)
const errorMessage = ref('')

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

const location = computed(() => snapshot.value?.location ?? null)

/** 状态在页面停留期间会自然变旧，必须按当前时间重算 */
const status = computed(() =>
  resolveOnlineStatus(location.value?.recordedAt ?? null, configStore.config.thresholds, now.value),
)
const statusMeta = computed(() => ONLINE_STATUS_META[status.value])

const locationText = computed(() => {
  if (!location.value) {
    return '暂无定位数据'
  }
  return location.value.address || formatCoordinate(location.value.latitude, location.value.longitude)
})

async function fetchSnapshot(options: { silent?: boolean } = {}) {
  if (!options.silent) {
    loading.value = true
  }
  try {
    snapshot.value = await getDeviceLatestLocation(deviceId.value)
    errorMessage.value = ''
    now.value = Date.now()
  }
  catch (error) {
    // 接口失败时保留最后一次成功的快照，并明确标记数据时间，不伪装成实时数据
    errorMessage.value = (error as Error)?.message || '网络异常，请稍后重试'
  }
  finally {
    loading.value = false
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
    return
  }
  fetchSnapshot()
})

onShow(() => {
  startTicker()
})

onHide(stopTicker)
onUnload(stopTicker)
</script>

<template>
  <view class="min-h-screen bg-gray-100 pb-6">
    <view v-if="loading" class="px-3 pt-3">
      <view class="rounded-3 bg-white px-4 py-4">
        <wd-skeleton :row-col="[{ width: '50%' }, { width: '80%' }, 1, 1]" animation="gradient" />
      </view>
    </view>

    <template v-else>
      <!-- 设备不存在或无权限时统一提示，不区分两者，避免泄露设备是否存在 -->
      <view v-if="errorMessage && !snapshot" class="flex flex-col items-center px-6 py-20">
        <view class="i-carbon-locked text-16 text-gray-300" />
        <view class="mt-4 text-4 text-gray-500">
          {{ errorMessage }}
        </view>
        <view class="mt-6">
          <wd-button size="small" plain @click="fetchSnapshot()">
            重试
          </wd-button>
        </view>
      </view>

      <template v-else>
        <!-- 顶部状态栏 -->
        <view class="bg-white px-4 py-3">
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
          <view class="mt-2 text-3.5 text-gray-500">
            {{ statusMeta.hint }}
          </view>
          <view v-if="location" class="mt-1 text-3 text-gray-400">
            定位时间 {{ formatDateTime(location.recordedAt) }}（{{ formatRelativeTime(location.recordedAt, now) }}）
          </view>
          <view v-else-if="snapshot?.lastSeenAt" class="mt-1 text-3 text-gray-400">
            最后通信 {{ formatDateTime(snapshot.lastSeenAt) }}（{{ formatRelativeTime(snapshot.lastSeenAt, now) }}）
          </view>
        </view>

        <view
          v-if="errorMessage"
          class="mx-3 mt-3 flex items-center rounded-2 bg-orange-50 px-3 py-2 text-3.5 text-orange-600"
        >
          <view class="i-carbon-warning mr-2 flex-shrink-0" />
          <text class="flex-1">
            {{ errorMessage }}，以下为最后一次成功获取的数据
          </text>
        </view>

        <!-- 位置信息卡 -->
        <view class="mx-3 mt-3 rounded-3 bg-white px-4 py-3">
          <view class="flex items-start">
            <view class="i-carbon-location mr-2 mt-1 flex-shrink-0 text-gray-400" />
            <text class="flex-1 text-4">
              {{ locationText }}
            </text>
          </view>

          <template v-if="location">
            <view class="mt-3 border-t border-gray-100 pt-3 text-3.5">
              <view class="flex py-1">
                <text class="w-20 text-gray-400">
                  经纬度
                </text>
                <text class="flex-1">
                  {{ formatCoordinate(location.latitude, location.longitude) }}
                </text>
              </view>
              <view class="flex py-1">
                <text class="w-20 text-gray-400">
                  坐标系
                </text>
                <text class="flex-1 uppercase">
                  {{ location.coordinateSystem }}
                </text>
              </view>
              <view class="flex py-1">
                <text class="w-20 text-gray-400">
                  速度
                </text>
                <text class="flex-1">
                  {{ formatSpeed(location.speed) }}
                </text>
              </view>
              <view class="flex py-1">
                <text class="w-20 text-gray-400">
                  定位精度
                </text>
                <text class="flex-1">
                  {{ formatAccuracy(location.accuracy) }}
                </text>
              </view>
              <view class="flex py-1">
                <text class="w-20 text-gray-400">
                  电量
                </text>
                <text class="flex-1">
                  {{ formatBattery(location.battery) }}
                </text>
              </view>
            </view>
          </template>

          <view v-else class="mt-3 border-t border-gray-100 pt-3 text-3.5 text-gray-500">
            该设备没有有效定位点，请检查设备定位权限与网络连接。
          </view>
        </view>

        <view class="mx-3 mt-4">
          <wd-button plain block @click="fetchSnapshot({ silent: true })">
            刷新
          </wd-button>
        </view>
      </template>
    </template>
  </view>
</template>
