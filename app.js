App({
  onLaunch() {
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    const scheduleConfig = wx.getStorageSync('scheduleConfig')
    if (token) {
      this.globalData.token = token
      this.globalData.userInfo = userInfo || null
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
