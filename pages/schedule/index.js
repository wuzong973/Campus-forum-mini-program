const app = getApp()
const api = require('../../utils/api')

const WEEK_DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const TIME_SLOTS = [
  '08:00', '08:55', '10:00', '10:55', '14:00', '14:55', '16:00', '16:55', '19:00', '19:55'
]

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    currentWeek: 1,
    isExpired: false,
    showDrawer: false,
    hideWeekend: false,
    reminder: false,
    bgColor: '#F5F7FA',
    courses: [],
    weekDays: WEEK_DAYS.slice(1, 8),
    timeSlots: TIME_SLOTS,
    grid: []
  },

  onLoad() {
    this.initFromConfig()
    this.loadSchedule()
  },

  onShow() {
    this.loadSchedule()
  },

  initFromConfig() {
    const config = app.globalData.scheduleConfig
    const startDate = new Date(config.startDate || '2025-09-01')
    const now = new Date()
    const diffDays = Math.floor((now - startDate) / 86400000)
    const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1)
    const isExpired = currentWeek > 20
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      hideWeekend: config.hideWeekend,
      reminder: config.reminder,
      bgColor: config.bgColor,
      currentWeek,
      isExpired
    })
  },

  loadSchedule() {
    api.getScheduleList().then((courses) => {
      const list = courses || []
      this.setData({
        courses: list,
        isExpired: list.length === 0 && this.data.isExpired,
        grid: this.buildGrid(list)
      })
    })
  },

  buildGrid(courses) {
    const grid = {}
    courses.forEach((c) => {
      const key = c.weekDay + '-' + c.startTime
      grid[key] = c
    })
    return grid
  },

  toggleDrawer() {
    this.setData({ showDrawer: !this.data.showDrawer })
  },

  closeDrawer() {
    this.setData({ showDrawer: false })
  },

  onHideWeekend(e) {
    const val = e.detail.value
    this.setData({ hideWeekend: val })
    app.saveScheduleConfig({ hideWeekend: val })
  },

  onReminder(e) {
    const val = e.detail.value
    this.setData({ reminder: val })
    app.saveScheduleConfig({ reminder: val })
    if (val) {
      wx.showToast({ title: '提醒将在首页展示', icon: 'none' })
    }
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/schedule-add/index' })
  },

  goOcr() {
    wx.navigateTo({ url: '/pages/schedule-ocr/index' })
  },

  onRefresh() {
    this.initFromConfig()
    this.loadSchedule()
    wx.showToast({ title: '已刷新', icon: 'success' })
  },

  goSetDate() {
    wx.showModal({
      title: '设置开始日期',
      editable: true,
      placeholderText: '格式：2025-09-01',
      success: (res) => {
        if (res.confirm && res.content && /^\d{4}-\d{2}-\d{2}$/.test(res.content)) {
          app.saveScheduleConfig({ startDate: res.content })
          this.initFromConfig()
          wx.showToast({ title: '日期已更新', icon: 'success' })
        } else if (res.confirm) {
          wx.showToast({ title: '日期格式不正确', icon: 'none' })
        }
      }
    })
  },

  onBgColor() {
    const colors = ['#F5F7FA', '#E8F0FF', '#FFF7E6', '#F6FFED']
    const idx = colors.indexOf(this.data.bgColor)
    const next = colors[(idx + 1) % colors.length]
    this.setData({ bgColor: next })
    app.saveScheduleConfig({ bgColor: next })
  }
})
