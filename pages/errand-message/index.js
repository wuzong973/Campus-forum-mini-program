const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { runPullDownRefresh } = require('../../utils/refresh')
const { formatRelativeTime } = require('../../utils/format')

// 跑腿消息列表：接单/发单订单的专属聊天会话（与"我的消息"私信列表完全独立）
Page({
  data: {
    chats: [],
    loading: true,
    statusBarHeight: 20,
    navBarHeight: 44
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    })
  },

  onShow() {
    this.loadChats()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadChats())
  },

  loadChats() {
    if (!auth.isLoggedIn()) {
      this.setData({ chats: [], loading: false })
      return Promise.resolve()
    }
    return api.getErrandChats().then((res) => {
      const list = (res && res.list) || []
      this.setData({
        chats: list.map((c) => ({
          orderId: c.orderId,
          peerName: c.peerName || '校园用户',
          peerAvatar: c.peerAvatar || '/assets/icons/avatar.png',
          roleLabel: c.role === 'publisher' ? '我发布的' : '我接的单',
          orderDesc: (c.orderRemark || c.orderTitle || '').slice(0, 30),
          rewardText: Number(c.reward || 0).toFixed(2),
          lastText: c.lastText || '暂无聊天消息',
          timeText: formatRelativeTime(c.lastTime) || '',
          unreadCount: c.unreadCount || 0
        })),
        loading: false
      })
    }).catch(() => {
      this.setData({ chats: [], loading: false })
    })
  },

  openChat(e) {
    const orderId = e.currentTarget.dataset.id
    if (!orderId) return
    wx.navigateTo({ url: '/pages/errand-chat/index?orderId=' + orderId })
  },

  goHall() {
    wx.switchTab({ url: '/pages/errand/index' })
  }
})
