const api = require('../../utils/api')
const auth = require('../../utils/auth')
const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    // 接单大厅筛选
    campusGroups: [
      { name: '广州校区', campuses: ['新港校区', '琶洲校区'] },
      { name: '佛山校区', campuses: ['南海南校区', '南海北校区'] }
    ],
    visibleCampusGroups: [],
    isAdmin: false,
    activeRegion: -1,
    subCampuses: [],
    activeSubCampus: '',
    types: ['全部类型', '外卖', '快递', '帮买'],
    activeType: 0,
    prices: ['全部价格', '1-3元', '3-5元', '5元以上'],
    activePrice: 0,
    orders: [],
    loading: false,
    // 底部Tab
    activeTab: 0
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    this.initCampusFilter()
    this.loadOrders()
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setSelected(2)
    this.loadOrders()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadOrders())
  },

  loadOrders() {
    const type = this.getTypeFilter()
    const campus = this.getRegionFilter()
    this.setData({ loading: true })
    const price = this.getPriceRange() || {}
    api.getErrandList({ type, campus, minPrice: price.min, maxPrice: price.max, page: 1, pageSize: 20 }).then((res) => {
      const orders = (res.list || []).map((o) => this.normalizeOrder(o))
      this.setData({ orders, loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  getTypeFilter() {
    const t = this.data.types[this.data.activeType]
    return t === '全部类型' ? '' : t
  },

  getRegionFilter() {
    return this.data.activeSubCampus || ''
  },

  initCampusFilter() {
    const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {}
    const isAdmin = ['admin', 'super_admin'].indexOf(userInfo.role) > -1
    const userCampusGroup = this.data.campusGroups.find((group) => group.campuses.indexOf(userInfo.campus) > -1)
    const visibleCampusGroups = isAdmin ? this.data.campusGroups : (userCampusGroup ? [userCampusGroup] : [])
    const activeRegion = userCampusGroup ? visibleCampusGroups.indexOf(userCampusGroup) : -1
    const group = activeRegion > -1 ? visibleCampusGroups[activeRegion] : null
    this.setData({
      isAdmin,
      visibleCampusGroups,
      activeRegion,
      subCampuses: group ? group.campuses : [],
      activeSubCampus: group ? userInfo.campus : ''
    })
  },

  getPriceRange() {
    const p = this.data.prices[this.data.activePrice]
    if (p === '1-3元') return { min: 1, max: 3 }
    if (p === '3-5元') return { min: 3, max: 5 }
    if (p === '5元以上') return { min: 5, max: 999 }
    return null
  },

  normalizeOrder(o) {
    if (o.statusClass) return o
    const format = require('../../utils/format')
    const timeLimit = o.pickupTimeType || o.pickup_time_type || '尽快'
    const genderReq = o.genderRequirement || o.gender_requirement || o.genderReq || '不限性别'
    const isLargeItem = o.isLargeItem || o.is_large_item || false
    const isUrgent = o.isUrgent || o.is_urgent || false
    const extraTags = []
    if (isLargeItem) extraTags.push('大件')
    if (isUrgent) extraTags.push('加急')
    return {
      id: o.id,
      status: o.status === 'pending' ? '待接单' : '已接单',
      statusClass: o.status === 'pending' ? 'pending' : 'accepted',
      price: o.reward || o.totalAmount,
      title: o.title || ((o.type || '快递') + '代拿'),
      campus: o.campus || '未填写校区',
      pickupAddr: o.pickupAddr || o.pickup_addr || '',
      deliveryAddr: o.deliveryAddr || o.delivery_addr || '',
      itemCount: 1,
      smallCount: 1,
      timeLimit: timeLimit,
      genderReq: genderReq,
      noUpstairs: false,
      extraTags: extraTags,
      type: o.type,
      publishTime: format.formatRelativeTime(o.createdAt || o.created_at) || '刚刚',
      raw: o
    }
  },

  goBack() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onRegionSelect(e) {
    const activeRegion = Number(e.currentTarget.dataset.index)
    const group = this.data.visibleCampusGroups[activeRegion]
    this.setData({
      activeRegion,
      subCampuses: group ? group.campuses : [],
      activeSubCampus: '',
      orders: []
    })
  },

  onSubCampusSelect(e) {
    this.setData({ activeSubCampus: e.currentTarget.dataset.value })
    this.loadOrders()
  },

  onAllRegionSelect() {
    this.setData({ activeRegion: -1, subCampuses: [], activeSubCampus: '' })
    this.loadOrders()
  },

  onTypeSelect(e) {
    this.setData({ activeType: Number(e.currentTarget.dataset.index) })
    this.loadOrders()
  },

  onPriceSelect(e) {
    this.setData({ activePrice: Number(e.currentTarget.dataset.index) })
    this.loadOrders()
  },

  onAccept(e) {
    const order = e.detail && e.detail.order ? e.detail.order : (e.currentTarget.dataset.order || {})
    const orderId = order.id || (order.raw && order.raw.id)
    if (!auth.requireRunnerReady()) return
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

  onOpenDetail(e) {
    const order = e.currentTarget.dataset.order || {}
    const id = order.id || (order.raw && order.raw.id)
    if (!id) return
    wx.navigateTo({ url: '/pages/errand-detail/index?id=' + id })
  },

  goPublish() {
    if (!auth.requireLogin('发布跑腿需要先登录')) return
    wx.navigateTo({ url: '/pages/errand-publish/index' })
  },

  // 底部Tab切换
  onSubTab(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ activeTab: index })
    if (index === 1) {
      // 发布跑腿
      if (!auth.requireLogin('发布跑腿需要先登录')) return
      wx.navigateTo({ url: '/pages/errand-publish/index' })
    } else if (index === 2) {
      // 我的订单
      wx.navigateTo({ url: '/pages/errand-order/index' })
    }
  }
})
