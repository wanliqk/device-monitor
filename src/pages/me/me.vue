<script lang="ts" setup>
import { computed, ref } from 'vue'
import { getDeviceList } from '@/api/device'
import { useTokenStore } from '@/store/token'
import { useUserStore } from '@/store/user'

defineOptions({
  name: 'MePage',
})

definePage({
  style: {
    navigationBarTitleText: '我的',
  },
})

const userStore = useUserStore()
const tokenStore = useTokenStore()
const deviceCount = ref(0)
const loading = ref(false)
const errorMessage = ref('')

const displayName = computed(() => userStore.userInfo.nickname || userStore.userInfo.username || '本地演示用户')
const accountText = computed(() => userStore.userInfo.username || '微信演示会话')
const avatar = computed(() => userStore.userInfo.avatar || '/static/images/default-avatar.png')

async function fetchDeviceCount() {
  loading.value = true
  errorMessage.value = ''
  try {
    let cursor: string | null = null
    let total = 0
    // 列表接口使用游标分页；只在本页统计授权设备，不依赖前端写死数量。
    for (let page = 0; page < 100; page++) {
      const result = await getDeviceList({ cursor, limit: 100 })
      total += result.items.length
      if (!result.nextCursor) {
        break
      }
      cursor = result.nextCursor
    }
    deviceCount.value = total
  }
  catch (error) {
    errorMessage.value = (error as Error)?.message || '设备数量获取失败'
  }
  finally {
    loading.value = false
  }
}

function showPrivacy() {
  uni.showModal({
    title: '隐私保护说明',
    content: '本小程序仅为已授权用户展示绑定设备的位置、状态和历史轨迹。位置数据用于设备调度与安全管理，不用于与功能无关的画像或广告；数据保存期限以服务端及隐私指引公示为准，超期后删除或匿名化。我们不会在产品埋点中记录完整经纬度、详细地址或访问令牌。',
    showCancel: false,
  })
}

function logout() {
  uni.showModal({
    title: '退出登录',
    content: '退出后需要重新登录才能查看设备，确定退出吗？',
    success: async (result) => {
      if (!result.confirm) {
        return
      }
      await tokenStore.logout()
      uni.reLaunch({ url: '/pages/login/index' })
    },
  })
}

onShow(() => {
  fetchDeviceCount()
})
</script>

<template>
  <view class="min-h-screen bg-gray-100 px-3 py-3">
    <view class="rounded-3 bg-white px-4 py-5">
      <view class="flex items-center">
        <image class="h-14 w-14 rounded-full bg-gray-100" :src="avatar" mode="aspectFill" />
        <view class="ml-3 min-w-0 flex-1">
          <view class="truncate text-5 font-medium">
            {{ displayName }}
          </view>
          <view class="mt-1 truncate text-3.5 text-gray-400">
            {{ accountText }}
          </view>
        </view>
      </view>
      <view class="mt-5 flex border-t border-gray-100 pt-4">
        <view class="flex-1 text-center">
          <view class="text-6 text-primary font-medium">
            {{ loading ? '--' : deviceCount }}
          </view>
          <view class="mt-1 text-3.5 text-gray-400">
            可查看设备
          </view>
        </view>
      </view>
    </view>

    <view v-if="errorMessage" class="mt-3 rounded-2 bg-red-50 px-3 py-2 text-3.5 text-red-500">
      {{ errorMessage }}
    </view>

    <view class="mt-3 overflow-hidden rounded-3 bg-white">
      <view class="flex items-center border-b border-gray-100 px-4 py-4" @click="showPrivacy">
        <view class="i-carbon-security mr-3 text-5 text-gray-500" />
        <text class="flex-1 text-3.75">隐私保护说明</text>
        <view class="i-carbon-chevron-right text-gray-300" />
      </view>
      <view class="flex items-center px-4 py-4" @click="logout">
        <view class="i-carbon-logout mr-3 text-5 text-gray-500" />
        <text class="flex-1 text-3.75">退出登录</text>
        <view class="i-carbon-chevron-right text-gray-300" />
      </view>
    </view>
  </view>
</template>
