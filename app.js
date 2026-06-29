const messageStore = require('./utils/messageStore')

App({
  onLaunch() {
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    const scheduleConfig = wx.getStorageSync('scheduleConfig')
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo || null
      // 初始化 WebSocket 连接 + 同步未读数
      messageStore.connect()
      messageStore.syncUnreadCount()
    }
    if (scheduleConfig) {
      this.globalData.scheduleConfig = Object.assign({}, this.globalData.scheduleConfig, scheduleConfig)
    }
    const sysInfo = wx.getSystemInfoSync()
    const menuBtn = wx.getMenuButtonBoundingClientRect()
    this.globalData.statusBarHeight = sysInfo.statusBarHeight
    this.globalData.navBarHeight = (menuBtn.top - sysInfo.statusBarHeight) * 2 + menuBtn.height
    this.globalData.menuButtonInfo = menuBtn
    this.globalData.screenWidth = sysInfo.screenWidth
    this.globalData.pixelRatio = sysInfo.pixelRatio || 2
  },

  onShow() {
    // 应用回到前台时重连 WebSocket 并同步未读数
    if (this.globalData.token) {
      messageStore.connect()
      messageStore.syncUnreadCount()
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
  },

  // 退出登录时调用：断开连接并清空未读提醒
  onLogout() {
    messageStore.disconnect()
    messageStore.setUnreadTotal(0)
  },

  saveScheduleConfig(config) {
    this.globalData.scheduleConfig = Object.assign({}, this.globalData.scheduleConfig, config)
    wx.setStorageSync('scheduleConfig', this.globalData.scheduleConfig)
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
      startDate: '2025-09-01',
      hideWeekend: false,
      reminder: false,
      bgColor: '#F5F7FA'
    }
  }
})
