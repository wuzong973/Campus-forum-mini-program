const messageStore = require('./utils/messageStore')
const loginExpiry = require('./utils/login-expiry')
const syncQueue = require('./utils/syncQueue')
const share = require('./utils/share')
const avatar = require('./utils/avatar')
const versionUpdate = require('./utils/version-update')
const subscribe = require('./utils/subscribe')
const scheduleUtil = require('./utils/schedule')

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
    this.installRouteGuards()
    this.installPrivacyGuards()
    // 尽早注册微信更新包事件，避免首页 onLoad 时已经错过 onUpdateReady。
    versionUpdate.ensureManager()
    // 1. 检查登录时效性（token 自身过期 / 90 天未使用则清除登录凭证）
    // checkLoginExpiry 返回 false 或 { reason }：reason 用于区分文案，
    // 两种情形都必须明确告知并引导重新登录，否则用户会停在「看似已登录、
    // 实际所有接口都 401」的僵尸态里。
    const expired = loginExpiry.checkLoginExpiry()
    if (expired) {
      const reason = expired && expired.reason ? expired.reason : 'inactive'
      wx.showModal({
        title: '登录已过期',
        content: reason === 'token-expired'
          ? '登录状态已失效，请重新登录后继续使用'
          : '您已超过 90 天未使用小程序，为保障账号安全，请重新登录',
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
    const defaultProfile = avatar.getDefaultProfile()
    if (userInfo) {
      // 兼容重命名前的旧头像路径（/assets/avatar2/1%20(9).jpg 这类真机渲染失败的地址）
      userInfo.avatarUrl = avatar.normalizeLegacyAvatar(userInfo.avatarUrl)
      if (!avatar.isStoredAvatar(userInfo.avatarUrl)) userInfo.avatarUrl = defaultProfile.avatarUrl
      if (avatar.isDefaultName(userInfo.nickName)) userInfo.nickName = defaultProfile.nickName
      wx.setStorageSync('userInfo', userInfo)
    }
    const scheduleConfig = wx.getStorageSync('scheduleConfig')
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo || null
      // 初始化 WebSocket 连接 + 同步未读数
      messageStore.connect()
      // 冷启动未读提示（A3）：小程序被关闭期间收到的消息，WebSocket 与角标都触达不到，
      // 重新打开的这一瞬间是唯一能补上告知的时机
      messageStore.syncUnreadCount().then((total) => this.noticeColdStartUnread(total)).catch(() => {})
      syncQueue.flushProfile().catch(() => {})
      syncQueue.flushScheduleConfig().then(() => this.syncScheduleConfig()).catch(() => {})
    }
    if (scheduleConfig) {
      this.globalData.scheduleConfig = Object.assign({}, this.globalData.scheduleConfig, scheduleConfig)
      // 自愈：旧版本只校验日期形状，2026-02-30 这类值会写进本地配置和离线队列，
      // 之后每次冷启动都被服务端拒绝，连带另外三项设置一起存不上；这里就地纠正并回写
      const fixedStartDate = scheduleUtil.legalizeStartDate(this.globalData.scheduleConfig.startDate)
      if (fixedStartDate !== this.globalData.scheduleConfig.startDate) {
        this.globalData.scheduleConfig = Object.assign({}, this.globalData.scheduleConfig, { startDate: fixedStartDate })
        wx.setStorageSync('scheduleConfig', this.globalData.scheduleConfig)
      }
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

  // 路由防重：短时间重复触发的路由（快速双击、事件冒泡双触发、点已选中 tab）会引发
  // 框架报错 "routeDone with a webviewId xxx is not found"（Page route 错误 system error）。
  // 这里对四类跳转 API 加“进行中”锁：同一时刻只放行一条路由，重复调用静默忽略——
  // 表现与原生一致（动画期间再点无响应），不再产生重复路由报错。
  installRouteGuards() {
    if (this._routeGuardsInstalled) return
    this._routeGuardsInstalled = true
    const ROUTE_APIS = ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab']
    let routeInFlight = false
    ROUTE_APIS.forEach((name) => {
      const original = wx[name]
      if (typeof original !== 'function' || original.__routeGuarded) return
      const guarded = (options = {}) => {
        if (routeInFlight) return
        routeInFlight = true
        const release = () => { routeInFlight = false }
        const wrapped = Object.assign({}, options)
        wrapped.success = (res) => {
          // success 只代表路由被接受，转场动画仍在进行；稍作停留再放行，覆盖动画窗口期
          setTimeout(release, 350)
          if (typeof options.success === 'function') options.success(res)
        }
        wrapped.fail = (res) => {
          // 失败立即放行：保留「navigateTo 失败回退 switchTab」这类失败链式跳转
          release()
          if (typeof options.fail === 'function') options.fail(res)
        }
        original.call(wx, wrapped)
      }
      guarded.__routeGuarded = true
      wx[name] = guarded
    })
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

  // 冷启动未读提示（A3）。
  // 小程序被关闭期间，WebSocket 断开、tabBar 角标也不在用户眼前 —— 那段时间收到的消息
  // （含匿名私信）完全没有触达手段，冷启动是唯一能补上告知的时机。
  // 只在本次冷启动提示一次；已有未读时不再重复打扰。
  noticeColdStartUnread(total) {
    const n = Number(total) || 0
    if (n <= 0 || this._coldStartUnreadNoticed) return
    this._coldStartUnreadNoticed = true
    // 延后到首页渲染完成再提示；期间用户若已自行进入消息页，就不再打扰
    setTimeout(() => {
      try {
        const pages = getCurrentPages()
        const cur = pages[pages.length - 1]
        if (cur && cur.route === 'pages/my-messages/index') return
        wx.showToast({ title: '你有 ' + n + ' 条新消息', icon: 'none', duration: 2000 })
      } catch (e) { /* 提示失败不得影响启动 */ }
    }, 1500)
  },

  onShow() {
    // 应用回到前台时刷新活跃时间戳
    loginExpiry.recordActiveTime()
    // 刷新微信侧「总是允许」缓存：弹窗节流层要在 tap 的**同步**调用链里判定
    // 「用户是否已勾选总是允许」，那时来不及 await wx.getSetting，只能读这份缓存。
    // 用户可能刚在小程序设置页改过选择，所以每次回到前台都刷一遍。
    // 失败时静默（refreshAlwaysChoice 内部已 catch），调用方按「未勾选」处理。
    if (subscribe && typeof subscribe.refreshAlwaysChoice === 'function') {
      subscribe.refreshAlwaysChoice().catch(() => {})
    }
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
    if (!this.globalData.token) return Promise.resolve(null)
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
      startDate: '2026-09-07',
      hideWeekend: false,
      reminder: false,
      bgColor: '#F5F7FA'
    },
    needPrivacyAuthorization: false,
    privacyAuthorized: false
  }
})
