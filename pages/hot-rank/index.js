const api = require('../../utils/api')

const PERIODS = [
  { key: 'today', label: '今日热帖' },
  { key: 'week', label: '本周热帖' },
  { key: 'month', label: '本月热帖' },
  { key: 'halfyear', label: '半年热帖' },
  { key: 'year', label: '本年热帖' },
  { key: 'history', label: '历史热帖' }
]

Page({
  data: {
    statusBarHeight: 20,
    periods: PERIODS,
    periodIndex: 0,
    currentLabel: PERIODS[0].label,
    menuVisible: false,
    posts: [],
    loading: true
  },

  onLoad() {
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    this.loadPosts()
  },

  onPullDownRefresh() {
    this.loadPosts().then(() => wx.stopPullDownRefresh())
  },

  loadPosts() {
    const period = this.data.periods[this.data.periodIndex]
    this.setData({ loading: true })
    return api.getHotPostRank(period.key, 15).then((res) => {
      this.setData({ posts: (res && res.list) || [], loading: false })
    }).catch(() => this.setData({ posts: [], loading: false }))
  },

  toggleMenu() {
    this.setData({ menuVisible: !this.data.menuVisible })
  },

  closeMenu() {
    this.setData({ menuVisible: false })
  },

  onPeriodTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.periodIndex) {
      this.setData({ menuVisible: false })
      return
    }
    this.setData({
      periodIndex: index,
      currentLabel: this.data.periods[index].label,
      menuVisible: false,
      posts: []
    })
    this.loadPosts()
  },

  onCancelMenu() {
    this.setData({ menuVisible: false })
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/index/index' })
  }
})
