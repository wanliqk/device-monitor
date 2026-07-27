<script lang="ts" setup>
import type { DeviceSummary } from '@/api/types/device'
import { computed, ref } from 'vue'
import { getDeviceList } from '@/api/device'
import { useDeviceConfigStore } from '@/store/deviceConfig'
import { debounce } from '@/utils/debounce'
import { resolveOnlineStatus } from '@/utils/deviceStatus'
import DeviceCard from './components/DeviceCard.vue'

defineOptions({
  name: 'DeviceList',
})

definePage({
  type: 'home',
  style: {
    navigationBarTitleText: '我的设备',
    enablePullDownRefresh: true,
    backgroundTextStyle: 'dark',
  },
})

const configStore = useDeviceConfigStore()

const keyword = ref('')
const devices = ref<DeviceSummary[]>([])
const nextCursor = ref<string | null>(null)
/** 首屏骨架屏只在第一次进入时展示，后续刷新不再闪烁 */
const firstLoading = ref(true)
const loadingMore = ref(false)
const errorMessage = ref('')

/**
 * 页面统一的当前时间。
 * 列表停留期间「12 秒前」会变成「2 分钟前」，在线状态也会随之变化，
 * 所以不能只用进入页面时服务端返回的状态快照。
 */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

const thresholds = computed(() => configStore.config.thresholds)

const onlineCount = computed(() =>
  devices.value.filter(
    device => resolveOnlineStatus(device.location?.recordedAt ?? null, thresholds.value, now.value) === 'online',
  ).length,
)

const isSearching = computed(() => keyword.value.trim().length > 0)
const isEmpty = computed(() => !firstLoading.value && !errorMessage.value && devices.value.length === 0)

async function fetchList(options: { reset?: boolean } = {}) {
  const reset = options.reset !== false
  if (!reset && (loadingMore.value || !nextCursor.value)) {
    return
  }

  if (reset) {
    errorMessage.value = ''
  }
  else {
    loadingMore.value = true
  }

  try {
    const res = await getDeviceList({
      keyword: keyword.value.trim(),
      cursor: reset ? null : nextCursor.value,
      limit: 20,
    })
    devices.value = reset ? res.items : [...devices.value, ...res.items]
    nextCursor.value = res.nextCursor
    now.value = Date.now()
  }
  catch (error) {
    // 保留上一次成功的数据，只提示错误，不把页面清空成「无设备」
    if (reset && devices.value.length === 0) {
      devices.value = []
    }
    errorMessage.value = (error as Error)?.message || '网络异常，请稍后重试'
  }
  finally {
    firstLoading.value = false
    loadingMore.value = false
  }
}

const debouncedSearch = debounce(() => {
  firstLoading.value = devices.value.length === 0
  fetchList({ reset: true })
}, 300)

function handleKeywordChange() {
  debouncedSearch()
}

function handleSearchConfirm() {
  debouncedSearch.cancel()
  fetchList({ reset: true })
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

function goDetail(device: DeviceSummary) {
  uni.navigateTo({
    url: `/pages/device/detail?deviceId=${device.id}&name=${encodeURIComponent(device.name)}`,
  })
}

onLoad(() => {
  configStore.ensureLoaded()
  fetchList({ reset: true })
})

onShow(() => {
  startTicker()
  // 从详情页返回时静默刷新，避免看到过期的列表状态
  if (!firstLoading.value) {
    fetchList({ reset: true })
  }
})

// 回到后台时停止高频 UI 更新
onHide(stopTicker)
onUnload(() => {
  stopTicker()
  debouncedSearch.cancel()
})

onPullDownRefresh(async () => {
  await fetchList({ reset: true })
  uni.stopPullDownRefresh()
})

onReachBottom(() => {
  fetchList({ reset: false })
})
</script>

<template>
  <view class="min-h-screen bg-gray-100">
    <view class="bg-white px-3 pb-1 pt-2">
      <wd-search
        v-model="keyword"
        placeholder="搜索设备名称或编号"
        hide-cancel
        placeholder-left
        @change="handleKeywordChange"
        @search="handleSearchConfirm"
        @clear="handleSearchConfirm"
      />
    </view>

    <view class="px-3 py-3">
      <!-- 首屏骨架屏 -->
      <template v-if="firstLoading">
        <view v-for="index in 3" :key="index" class="mb-3 rounded-3 bg-white px-4 py-3">
          <wd-skeleton :row-col="[{ width: '40%' }, { width: '60%' }, { width: '80%' }]" animation="gradient" />
        </view>
      </template>

      <!-- 网络异常：保留最后一次成功的数据，仅提示并提供重试 -->
      <template v-else>
        <view
          v-if="errorMessage"
          class="mb-3 flex items-center rounded-2 bg-red-50 px-3 py-2 text-3.5 text-red-500"
        >
          <view class="i-carbon-warning mr-2 flex-shrink-0" />
          <text class="flex-1">
            {{ errorMessage }}
          </text>
          <text class="ml-2 text-primary" @click="fetchList({ reset: true })">
            重试
          </text>
        </view>

        <view v-if="devices.length > 0" class="mb-2 px-1 text-3 text-gray-400">
          共 {{ devices.length }} 台设备，{{ onlineCount }} 台在线
        </view>

        <DeviceCard
          v-for="device in devices"
          :key="device.id"
          :device="device"
          :thresholds="thresholds"
          :now="now"
          @click="goDetail"
        />

        <view v-if="loadingMore" class="py-3 text-center text-3 text-gray-400">
          加载中...
        </view>

        <!-- 空态：搜索无结果与未绑定设备是两回事，文案必须区分 -->
        <view v-if="isEmpty" class="flex flex-col items-center px-6 py-20">
          <view class="i-carbon-devices text-16 text-gray-300" />
          <view class="mt-4 text-4 text-gray-500">
            {{ isSearching ? '没有匹配的设备' : '暂无可查看的设备' }}
          </view>
          <view class="mt-2 text-center text-3.5 text-gray-400">
            {{ isSearching ? '换个设备名称或编号试试' : '请联系管理员为您绑定设备' }}
          </view>
        </view>
      </template>
    </view>
  </view>
</template>
