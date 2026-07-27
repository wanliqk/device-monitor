<script lang="ts" setup>
import { ref } from 'vue'
import { useTokenStore } from '@/store/token'

defineOptions({
  name: 'LoginPage',
})

definePage({
  excludeLoginPath: true,
  style: {
    navigationBarTitleText: '登录',
  },
})

const tokenStore = useTokenStore()
const loading = ref(false)
const errorMessage = ref('')
const redirectPath = ref('/pages/device/list')

function normalizeRedirect(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/pages/')) {
    return '/pages/device/list'
  }
  return value
}

async function login() {
  if (loading.value) {
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    await tokenStore.wxLogin()
    uni.reLaunch({ url: redirectPath.value })
  }
  catch (error) {
    errorMessage.value = (error as Error)?.message || '登录失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}

onLoad((options) => {
  if (tokenStore.updateNowTime().hasLogin) {
    uni.reLaunch({ url: normalizeRedirect(options?.redirect) })
    return
  }
  if (options?.redirect) {
    try {
      redirectPath.value = normalizeRedirect(decodeURIComponent(options.redirect))
    }
    catch {
      redirectPath.value = '/pages/device/list'
    }
  }
})
</script>

<template>
  <view class="min-h-screen flex flex-col items-center bg-white px-8 pt-28">
    <image class="h-20 w-20 rounded-5" src="/static/images/default-avatar.png" mode="aspectFit" />
    <view class="mt-5 text-6 font-medium">
      设备监控
    </view>
    <view class="mt-2 text-center text-3.5 text-gray-400">
      登录后查看已授权设备的位置与轨迹
    </view>
    <view v-if="errorMessage" class="mt-8 w-full rounded-2 bg-red-50 px-3 py-2 text-3.5 text-red-500">
      {{ errorMessage }}
    </view>
    <wd-button class="mt-10 w-full" type="primary" :loading="loading" @click="login">
      微信一键登录
    </wd-button>
    <view class="mt-5 text-center text-3 text-gray-400">
      登录即表示你已了解并同意位置数据使用说明
    </view>
  </view>
</template>
