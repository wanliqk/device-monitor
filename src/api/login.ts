import type { IAuthLoginRes, ICaptcha, IDoubleTokenRes, IUpdateInfo, IUpdatePassword, IUserInfoRes } from './types/login'
import { http } from '@/http/http'

/** 与设备接口保持同一开关；伪数据模式下提供可重复的本地会话。 */
const USE_MOCK_AUTH = import.meta.env.VITE_USE_MOCK !== 'false'

/**
 * 登录表单
 */
export interface ILoginForm {
  username: string
  password: string
}

/**
 * 获取验证码
 * @returns ICaptcha 验证码
 */
export function getCode() {
  return http.get<ICaptcha>('/user/getCode')
}

/**
 * 用户登录
 * @param loginForm 登录表单
 */
export function login(loginForm: ILoginForm) {
  return http.post<IAuthLoginRes>('/auth/login', loginForm)
}

/**
 * 刷新token
 * @param refreshToken 刷新token
 */
export function refreshToken(refreshToken: string) {
  return http.post<IDoubleTokenRes>('/auth/refreshToken', { refreshToken })
}

/**
 * 获取用户信息
 */
export function getUserInfo() {
  if (USE_MOCK_AUTH) {
    return Promise.resolve<IUserInfoRes>({
      userId: 1,
      username: 'demo-admin',
      nickname: '演示管理员',
      avatar: '/static/images/default-avatar.png',
      roles: ['admin'],
    })
  }
  return http.get<IUserInfoRes>('/user/info')
}

/**
 * 退出登录
 */
export function logout() {
  if (USE_MOCK_AUTH) {
    return Promise.resolve()
  }
  return http.get<void>('/auth/logout')
}

/**
 * 修改用户信息
 */
export function updateInfo(data: IUpdateInfo) {
  return http.post('/user/updateInfo', data)
}

/**
 * 修改用户密码
 */
export function updateUserPassword(data: IUpdatePassword) {
  return http.post('/user/updatePassword', data)
}

/**
 * 获取微信登录凭证
 * @returns Promise 包含微信登录凭证(code)
 */
export function getWxCode() {
  if (USE_MOCK_AUTH) {
    return Promise.resolve<UniApp.LoginRes>({ code: 'mock-code', errMsg: 'login:ok', authResult: '' })
  }
  return new Promise<UniApp.LoginRes>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: res => resolve(res),
      fail: err => reject(new Error(err)),
    })
  })
}

/**
 * 微信登录
 * @param params 微信登录参数，包含code
 * @returns Promise 包含登录结果
 */
export function wxLogin(data: { code: string }) {
  if (USE_MOCK_AUTH) {
    return Promise.resolve<IAuthLoginRes>({
      token: `mock-token-${data.code || 'local'}`,
      expiresIn: 7 * 24 * 60 * 60,
    })
  }
  return http.post<IAuthLoginRes>('/api/v1/auth/wechat-login', data)
}
