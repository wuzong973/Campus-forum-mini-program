const api = require('../../utils/api')
const auth = require('../../utils/auth')
const request = require('../../utils/request')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    tabs: ['快递', '外卖', '代办'],
    activeTab: 0,
    campuses: ['佛山校区', '广州校区'],
    activeCampus: 1,
    orders: [],
    subTab: 0,
    loading: false
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    this.loadOrders()
  },

  // 页面首次渲染完成后，自动跳转到「递至·校园代拿」小程序
  onReady() {
    this.openErrandMini()
  },

  loadOrders() {
    const type = this.data.tabs[this.data.activeTab]
    const campus = this.data.campuses[this.data.activeCampus]
    this.setData({ loading: true })
    api.getErrandList({ type, campus, page: 1, pageSize: 20 }).then((res) => {
      const orders = (res.list || []).map((o) => this.normalizeOrder(o))
      this.setData({ orders, loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  normalizeOrder(o) {
    if (o.statusClass) return o
    const format = require('../../utils/format')
    return {
      id: o.id,
      status: o.status === 'pending' ? '待接单' : '已接单',
      statusClass: o.status === 'pending' ? 'pending' : 'accepted',
      price: o.reward,
      campus: o.campus,
      address: (o.pickupAddr || '') + ' → ' + (o.deliveryAddr || ''),
      itemCount: 1,
      smallCount: 1,
      timeLimit: '不限时间',
      genderReq: '不限性别',
      noUpstairs: true,
      type: o.type,
      publishTime: format.formatRelativeTime(o.createdAt) + ' 发布',
      raw: o
    }
  },

  goBack() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.index })
    this.loadOrders()
  },

  onCampusSelect(e) {
    this.setData({ activeCampus: e.currentTarget.dataset.index })
    this.loadOrders()
  },

  onSubTab(e) {
    const index = e.currentTarget.dataset.index
    // 接单大厅 / 发布跑腿 / 我的订单：均跳转到「递至·校园代拿」小程序
    this.setData({ subTab: index })
    if (index === 1) {
      if (!auth.requireLogin('发布跑腿需要先登录')) return
    }
    this.openErrandMini()
  },

  onAccept(e) {
    const order = e.detail && e.detail.order ? e.detail.order : (e.currentTarget.dataset.order || {})
    const orderId = order.id || (order.raw && order.raw.id)
    if (!auth.requireLogin('接单需要先登录')) return
    wx.showModal({
      title: '确认接单',
      content: '确定接受此订单？',
      success: (res) => {
        if (!res.confirm) return
        if (request.USE_MOCK) {
          wx.showToast({ title: '接单成功', icon: 'success' })
          return
        }
        request.post('/errand/' + orderId + '/accept', {}, true).then(() => {
          wx.showToast({ title: '接单成功', icon: 'success' })
          this.loadOrders()
        })
      }
    })
  },

  // 跳转到「递至·校园代拿」小程序
  openErrandMini() {
    const ERRAND_APP_ID = 'wx4f4f74eaf4b7d100'
    console.log('[代拿跑腿] 准备跳转外部小程序 appId=', ERRAND_APP_ID)
    wx.navigateToMiniProgram({
      appId: ERRAND_APP_ID,
      envVersion: 'release',
      success() {
        console.log('[代拿跑腿] 跳转成功')
      },
      fail(err) {
        console.error('[代拿跑腿] 跳转失败', err)
        wx.showModal({
          title: '跳转失败',
          content: '错误信息：' + (err && err.errMsg ? err.errMsg : JSON.stringify(err)) + '\n\n可点击顶部"进入校园代拿"横幅重试。',
          showCancel: false
        })
      }
    })
  },

  // 手动点击 banner 跳转
  onEnterErrandMini() {
    wx.vibrateShort({ type: 'light' })
    this.openErrandMini()
  }
})
