const messageStore = require('./utils/messageStore')
const loginExpiry = require('./utils/login-expiry')
const syncQueue = require('./utils/syncQueue')
const share = require('./utils/share')

// 为所有页面提供默认分享配置，页面可自行定义同名生命周期来覆盖默认行为。
const originalPage = Page
Page = function (pageOptions) {
  if (typeof pageOptions.onShareAppMessage !== 'function') {
    pageOptions.onShareAppMessage = share.onShareAppMessage
  }
  if (typeof pageOptions.onShareTimeline !== 'function') {
    pageOptions.onShareTimeline = share.onShareTimeline
  }
  return originalPage(pageOptions)
}

App({
  onLaunch() {
    this.installPrivacyGuards()
    // 1. 检查登录时效性（90 天未使用则清除登录凭证）
    const expired = loginExpiry.checkLoginExpiry()
    if (expired) {
      wx.showModal({
        title: '登录已过期',
        content: '您已超过 90 天未使用小程序，为保障账号安全，请重新登录',
        showCancel: true,
        cancelText: '稍后再说',
        confirmText: '去登录',
        confirmColor: '#315CFF',
        success(res) {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/login/index' })
          }
        }
      })
    }

    // 2. 检查隐私授权状态（按微信官方指引）
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: (res) => {
          // res.needAuthorization: 是否需要隐私授权
          this.globalData.needPrivacyAuthorization = res.needAuthorization
        },
        fail: () => {
          // 兼容低版本基础库
          this.globalData.needPrivacyAuthorization = false
        }
      })
    } else {
      // 基础库不支持隐私接口，默认不需要授权
      this.globalData.needPrivacyAuthorization = false
    }

    // 3. 重新读取 token（可能已被清理）
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    const scheduleConfig = wx.getStorageSync('scheduleConfig')
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo || null
      // 初始化 WebSocket 连接 + 同步未读数
      messageStore.connect()
      messageStore.syncUnreadCount()
      syncQueue.flushProfile().catch(() => {})
      syncQueue.flushScheduleConfig().then(() => this.syncScheduleConfig()).catch(() => {})
    }
    if (scheduleConfig) {
      this.globalData.scheduleConfig = Object.assign({}, this.globalData.scheduleConfig, scheduleConfig)
    }
    const sysInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    const menuBtn = wx.getMenuButtonBoundingClientRect()
    this.globalData.statusBarHeight = sysInfo.statusBarHeight
    this.globalData.navBarHeight = (menuBtn.top - sysInfo.statusBarHeight) * 2 + menuBtn.height
    this.globalData.menuButtonInfo = menuBtn
    this.globalData.screenWidth = sysInfo.screenWidth
    this.globalData.pixelRatio = sysInfo.pixelRatio || 2
  },

  // Guard privacy-sensitive APIs at the platform boundary. This covers pages
  // added later without relying on each page to remember the authorization flow.
  installPrivacyGuards() {
    if (this._privacyGuardsInstalled || typeof wx.requirePrivacyAuthorize !== 'function') return
    this._privacyGuardsInstalled = true
    const privacyApis = ['getLocation', 'chooseLocation', 'chooseMedia', 'saveImageToPhotosAlbum']
    privacyApis.forEach((name) => {
      const original = wx[name]
      if (typeof original !== 'function' || original.__privacyGuarded) return
      const guarded = (options = {}) => {
        const invoke = () => original.call(wx, options)
        if (this.globalData.privacyAuthorized) return invoke()
        wx.requirePrivacyAuthorize({
          success: () => {
            this.globalData.privacyAuthorized = true
            invoke()
          },
          fail: () => {
            if (typeof options.fail === 'function') options.fail({ errMsg: 'privacy authorization denied' })
            else wx.showToast({ title: '请先同意隐私保护指引', icon: 'none' })
          }
        })
      }
      guarded.__privacyGuarded = true
      wx[name] = guarded
    })
  },

  onShow() {
    // 应用回到前台时刷新活跃时间戳
    loginExpiry.recordActiveTime()
    // 重连 WebSocket 并同步未读数
    if (this.globalData.token) {
      messageStore.connect()
      messageStore.syncUnreadCount()
      syncQueue.flushProfile().catch(() => {})
      syncQueue.flushScheduleConfig().then(() => this.syncScheduleConfig()).catch(() => {})
    }
  },

  onHide() {
    // 应用进入后台时断开连接以节省资源
    messageStore.disconnect()
  },

  // 登录成功后调用：建立 WebSocket 连接并拉取未读数
  onLogin() {
    messageStore.connect()
    messageStore.syncUnreadCount()
    syncQueue.flushProfile().catch(() => {})
    syncQueue.flushScheduleConfig().then(() => this.syncScheduleConfig()).catch(() => {})
  },

  // 退出登录时调用：断开连接并清空未读提醒
  onLogout() {
    messageStore.disconnect()
    messageStore.setUnreadTotal(0)
  },

  saveScheduleConfig(config) {
    this.globalData.scheduleConfig = Object.assign({}, this.globalData.scheduleConfig, config)
    wx.setStorageSync('scheduleConfig', this.globalData.scheduleConfig)
    if (this.globalData.token) {
      syncQueue.queueScheduleConfig(this.globalData.scheduleConfig)
      syncQueue.flushScheduleConfig().catch(() => {})
    }
  },

  syncScheduleConfig() {
    const request = require('./utils/request')
    if (!this.globalData.token || request.USE_MOCK) return Promise.resolve(null)
    return request.get('/schedule/config', {}, true, { silent: true }).then((config) => {
      if (!config) return null
      this.globalData.scheduleConfig = Object.assign({}, this.globalData.scheduleConfig, config)
      wx.setStorageSync('scheduleConfig', this.globalData.scheduleConfig)
      return config
    })
  },

  globalData: {
    token: '',
    userInfo: null,
    statusBarHeight: 20,
    navBarHeight: 44,
    menuButtonInfo: null,
    screenWidth: 375,
    pixelRatio: 2,
    scheduleConfig: {
      startDate: '2026-03-02',
      hideWeekend: false,
      reminder: false,
      bgColor: '#F5F7FA'
    },
    needPrivacyAuthorization: false,
    privacyAuthorized: false
  }
})
