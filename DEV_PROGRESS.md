# 开发进度与待办清单

> 更新日期：2026-07-27
> 对应设计文档：[MVP_DESIGN.md](./MVP_DESIGN.md)
> 当前范围：仅微信小程序端，服务端数据全部由 `src/mock` 提供伪数据

## 1. 当前状态总览

| 模块 | 状态 | 提交 |
| --- | --- | --- |
| 领域模型与地理/状态工具 | ✅ 已完成 | `7da1a33` |
| 伪数据层与设备业务接口 | ✅ 已完成 | `de189ae` |
| 设备列表页 | ✅ 已完成 | `4db9ef9` |
| 实时位置页（地图 + 推送通道） | ✅ 已完成 | `f36e8a4` |
| 导航到设备 + 埋点基础设施 | ✅ 已完成 | `ba8cb03` |
| 历史轨迹页 | ✅ 已完成 | 工作区本次实现 |
| 「我的」页与剩余埋点接入 | ✅ 已完成 | 工作区本次实现 |
| 微信登录与会话 | ✅ 已完成（客户端/mock） | 工作区本次实现 |

质量基线（每次提交前均已执行）：

- `pnpm test:run` — 124 个用例通过
- `pnpm lint` — 无新增问题（`package.json`、`pages.config.ts`、`scripts/bump-version.js`、
  `src/tabbar/TabbarItem.test.ts` 的报错是模板自带的历史问题，未在本次范围内处理）
- `pnpm type-check` — `src/` 目录无错误（`node_modules/@wot-ui/ui` 的报错是依赖自带）
- `pnpm build:mp` — 微信小程序构建通过

## 2. 已完成内容说明

### 2.1 目录结构

```text
src/
├── api/
│   ├── device.ts              # 设备业务接口，按 VITE_USE_MOCK 切换伪数据/真实后端
│   ├── deviceSocket.ts        # 位置实时通道，伪推送与真实 WSS 的统一封装
│   └── types/device.ts        # 领域模型
├── hooks/
│   ├── useDeviceRealtime.ts   # 订阅、去重、重连、轮询降级
│   └── useMapNavigation.ts    # openMapApp 拉起与降级
├── mock/
│   ├── deviceProfiles.ts      # 5 台演示设备档案
│   ├── deviceGenerator.ts     # 位置/轨迹纯函数生成器
│   └── deviceApi.ts           # 带时延的伪服务端 + 模拟推送
├── pages/device/
│   ├── list.vue               # 设备列表（首页 + tabbar）
│   ├── detail.vue             # 实时位置页
│   ├── track.vue              # 历史轨迹页
│   └── components/DeviceCard.vue
├── pages/login/index.vue      # 微信登录与会话入口
├── pages/me/me.vue             # 用户、设备数量、隐私与退出
├── store/deviceConfig.ts      # 服务端运行时配置缓存
└── utils/
    ├── geo.ts                 # 坐标校验、里程、抽稀、格式化
    ├── deviceStatus.ts        # 在线状态判定与时间格式化
    └── analytics.ts           # 产品埋点（拦截敏感字段）
```

### 2.2 演示设备

`src/mock/deviceProfiles.ts` 中的 5 台设备覆盖了全部异常态，便于逐条走验收用例：

| 设备 | 场景 |
| --- | --- |
| dev_001 巡检车 | 在线且持续移动，轨迹中含低精度点与跳点 |
| dev_002 冷链车 | 在线但静止，无逆地理编码结果（验证经纬度降级展示） |
| dev_003 外勤终端 | 上报滞后 130 秒，判定为「位置过期」 |
| dev_004 资产标签 | 上报滞后 3 小时，判定为「离线」，且不上报电量 |
| dev_005 新装设备 | 从未定位，但通信正常（验证 lastSeenAt 与定位时间的区别） |

### 2.3 切换到真实后端

把 `env/.env` 中的 `VITE_USE_MOCK` 改为 `'false'`，`src/api/device.ts` 与
`src/api/deviceSocket.ts` 会自动切到 MVP 设计文档第 8 章约定的 HTTPS/WSS 接口，页面代码无需改动。

## 3. 当前未完成/需外部配合模块

### 3.1 历史轨迹页（P0，已完成）

数据层已经就绪，`getDeviceTrack()` 与 `buildTrack()` 已实现范围裁剪、异常点过滤、
里程统计与抽稀，并有 10 个单元测试覆盖；页面已在本次实现并接入详情页入口。

`src/pages/device/track.vue` 已实现：

- 时间筛选：今天 / 昨天 / 自定义，自定义范围最多 24 小时（超出由服务端裁剪，页面需提示实际范围）；
- 地图：`polyline` 轨迹折线 + 起点/终点 Marker（图标已生成，见 `src/static/map/marker-start.png`、
  `marker-end.png`、`marker-point.png`）；
- 摘要卡：时间范围、估算里程（需标注「估算」）、原始点数与绘制点数、最后位置；
- 点击轨迹关键点展示该点的时间、速度、定位精度；
- 空态必须区分「设备从未上报」（`deviceEverReported === false`）和「筛选范围内无轨迹」；
- 展示 `qualityNotes` 中的数据质量提示（已过滤低精度点/跳点、抽稀前后点数）；
- 从 `detail.vue` 增加「查看轨迹」次操作入口。

`detail.vue` 底部已增加「查看轨迹」次操作入口。

### 3.2 「我的」页与剩余埋点（P1，已完成）

`src/pages/me/me.vue` 已实现：

- 展示当前登录用户与其可查看设备的数量；
- 隐私保护说明入口（说明位置数据的收集目的、使用方式、保存期限）；
- 退出登录。

埋点基础设施（`src/utils/analytics.ts`）及本次剩余事件均已接入：

| 事件 | 接入位置 |
| --- | --- |
| `device_list_view` | `pages/device/list.vue` 的 `onShow` |
| `device_detail_view` | `pages/device/detail.vue` 的 `onShow` |
| `track_query` | 轨迹页查询回调，带上成功与点数摘要 |
| `realtime_ws_connected` / `realtime_ws_disconnected` | `useDeviceRealtime` 的 `onOpen` / `onClose` |

### 3.3 微信登录与会话（P0，客户端/mock 已完成）

已完成客户端登录页、路由拦截、令牌过期跳转和 mock 会话；真实上线前需联调服务端响应：

- `wx.login` 换取 code，调用 `POST /api/v1/auth/wechat-login` 换取短期令牌
  （模板已有 `src/api/login.ts` 的 `getWxCode()` / `wxLogin()` 与 `src/store/token.ts` 可直接复用）；
- 登录页为 `src/pages/login/index.vue`，路由拦截使用 `EXCLUDE_LOGIN_PATH_LIST`；
- HTTP 401 会清理会话并跳转重新登录；
- `VITE_USE_MOCK=true` 时使用本地 token/用户信息，不阻塞本地开发。

### 3.4 本次范围之外（服务端 / 运维）

以下内容小程序端无法自证，必须由服务端与合规流程覆盖，详见 MVP 设计文档第 6、10 章：

- 设备级访问控制、位置查询审计、接口限流；
- 坐标系归一化（当前伪数据直接产出 gcj02，真实设备需服务端统一换算并做对点验证）；
- 轨迹数据保留期与删除/匿名化流程；
- 小程序隐私保护指引与隐私接口声明。

## 4. 未验证事项

单元测试与小程序构建可以覆盖逻辑与编译，但下列内容必须真机验证，目前尚未进行：

- `MapContext.openMapApp` 的真机拉起。开发者工具不能替代真机，需覆盖 iOS、Android
  以及「未安装地图 App」「安装多个地图 App」「系统限制拉起」三种情况；
- 地图 Marker、精度圈、轨迹折线的真机渲染效果与性能（尤其是 2000 点轨迹）；
- 前后台切换、弱网与断网下的实时链路重连与轮询降级；
- 微信基础库低版本（< 2.14.0）的降级路径。
