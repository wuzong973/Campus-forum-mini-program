const api = require('../../../utils/api')
const auth = require('../../../utils/auth')

const FALLBACK_AVATAR = '/assets/icons/avatar.png'

Page({
  data: {
    loading: true,
    feature: null,
    window: null,
    current: null,
    history: [],
    fallbackAvatar: FALLBACK_AVATAR,
    windowUsed: 0,
    windowRemaining: 10
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    const allowed = await auth.requireFeatureAccess('一周CP', { autoBack: true })
    if (!allowed) return
    this.setData({ loading: true })
    try {
      const data = await api.getCoupleHistory()
      const window = data.window || null
      const list = Array.isArray(data.list) ? data.list : []
      const current = data.current || null
      this.setData({
        loading: false,
        feature: data.feature || null,
        window,
        current,
        history: current ? list.filter((item) => !item.isCurrent) : list,
        windowUsed: window ? window.used : 0,
        windowRemaining: window ? window.remaining : 10
      })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  openCurrent() {
    if (!this.data.current) return
    wx.navigateTo({ url: '/pkg-feature/pages/couple/result?matchId=' + this.data.current.id })
  },

  openItem(e) {
    const id = Number(e.currentTarget.dataset.id)
    const status = e.currentTarget.dataset.status
    if (!id) return
    if (status === 'active') {
      wx.navigateTo({ url: '/pkg-feature/pages/couple/result?matchId=' + id })
      return
    }
    wx.navigateTo({ url: '/pkg-feature/pages/couple/chat?matchId=' + id })
  },

  goIndex() {
    wx.navigateTo({ url: '/pkg-feature/pages/couple/index' })
  }
})
