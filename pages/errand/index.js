const api = require('../../utils/api')
const auth = require('../../utils/auth')
const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

const STATUS_TEXT = {
  pending: '待接单',
  accepted: '进行中',
  done: '已完成',
  unpaid: '待支付',
  cancelled: '已取消',
  refunding: '退款中'
}

const TAB_EMPTY_TEXT = ['当前筛选下暂无可接订单', '还没有接过的订单', '还没有发布的订单', '暂无已完成的订单']

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    // 订单标签页：等待帮助→我接的单、我帮助的→已完成的
    listTabs: ['全部订单', '我接的单', '我发布的', '已完成的'],
    activeListTab: 0,
    showNoticeA: true,
    showNoticeB: true,
    emptyText: TAB_EMPTY_TEXT[0],
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
    this._mineCache = { published: null, accepted: null }
    this.initCampusFilter()
    this.loadCurrentTab()
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setSelected(2)
    this.loadCurrentTab()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadCurrentTab())
  },

  // ===== 标签页调度 =====
  onListTab(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.activeListTab) return
    this.setData({ activeListTab: index, orders: [], emptyText: TAB_EMPTY_TEXT[index] })
    this.loadCurrentTab()
  },

  loadCurrentTab() {
    const tab = this.data.activeListTab
    if (tab === 0) return this.loadOrders()
    if (tab === 3) return this.loadMine(['published', 'accepted'], 'done')
    if (tab === 1) return this.loadMine(['accepted'])
    return this.loadMine(['published'])
  },

  // ===== 全部订单（接单大厅） =====
  loadOrders() {
    const campus = this.getRegionFilter()
    this.setData({ loading: true })
    api.getErrandList({ campus, page: 1, pageSize: 20 }).then((res) => {
      const orders = (res.list || []).map((o) => this.normalizeOrder(o))
      this.setData({ orders, loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  // ===== 我接的单 / 我发布的 / 已完成的 =====
  loadMine(sources, onlyStatus) {
    this.setData({ loading: true })
    const need = sources.filter((key) => !this._mineCache[key])
    const loads = need.map((key) => {
      if (request.USE_MOCK) {
        const mock = require('../../utils/mock')
        const list = key === 'published' ? mock.myPublishedOrders.slice() : mock.myAcceptedOrders.slice()
        return Promise.resolve({ key, list })
      }
      const url = key === 'published' ? '/errand/my-published' : '/errand/my-accepted'
      return request.get(url, {}, true, { silent: true }).then((res) => ({ key, list: (res && res.list) || [] }))
    })
    Promise.all(loads).then((results) => {
      results.forEach(({ key, list }) => { this._mineCache[key] = list })
      let all = []
      sources.forEach((key) => { all = all.concat(this._mineCache[key] || []) })
      if (onlyStatus) all = all.filter((o) => this.effectiveStatus(o) === onlyStatus)
      const orders = all.map((o) => this.normalizeOrder(o))
      this.setData({ orders, loading: false })
    }).catch(() => {
      this.setData({ loading: false, emptyText: '加载失败，请下拉重试' })
    })
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

  // 支付状态修正：发布者未支付的待接单记为待支付；取消退款中记为退款中
  effectiveStatus(o) {
    const paymentStatus = String(o.paymentStatus || o.payment_status || 'SUCCESS').toUpperCase()
    const isPublisher = o.role === 'publisher'
    if (isPublisher && (o.status === 'pending' || !o.status) && !['SUCCESS', 'REFUNDING', 'REFUNDED'].includes(paymentStatus)) return 'unpaid'
    if (o.status === 'cancelled' && paymentStatus === 'REFUNDING') return 'refunding'
    if (o.status === 'finished') return 'done'
    return o.status || 'pending'
  },

  normalizeOrder(o) {
    const format = require('../../utils/format')
    const statusKey = this.effectiveStatus(o)
    const tab = this.data.activeListTab
    const expectText = o.expectTime || o.expect_time || o.appointmentTime ||
      (o.pickupTimeType === 'scheduled' && (o.pickupTime || o.pickup_time) ? (o.pickupTime || o.pickup_time) : '越快越好')
    return {
      id: o.id,
      status: STATUS_TEXT[statusKey] || '待接单',
      statusClass: statusKey,
      price: o.reward || o.totalAmount,
      title: o.title || ((o.type || '快递') + '代拿'),
      campus: o.campus || '未填写校区',
      authorName: o.nickname || o.authorName || o.userNickname || o.publisherName || o.publisher_name || '匿名同学',
      avatarUrl: o.avatarUrl || o.userAvatar || '/assets/icons/avatar.png',
      expectText: expectText,
      type: o.type,
      action: this.cardAction(statusKey, tab, o),
      publishTime: format.formatRelativeTime(o.createdAt || o.created_at) || '刚刚',
      raw: o
    }
  },

  // 各标签下的主操作按钮
  cardAction(statusKey, tab, o) {
    if (tab === 0) return statusKey === 'pending' ? 'grab' : ''
    if (tab === 1) return statusKey === 'accepted' ? 'finish' : ''
    if (tab === 2) {
      if (statusKey === 'unpaid') return 'pay'
      if (statusKey === 'pending') return 'cancel'
      if (statusKey === 'accepted') return 'contact'
      return ''
    }
    return ''
  },

  goBack() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // ===== 公告关闭 =====
  onCloseNotice(e) {
    this.setData({ [e.currentTarget.dataset.key]: false })
  },

  // ===== 区域筛选 =====
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

  // ===== 卡片操作 =====
  onAccept(e) {
    const order = e.currentTarget.dataset.order || {}
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
          this._mineCache = { published: null, accepted: null }
          this.loadCurrentTab()
        })
      }
    })
  },

  onPay(e) {
    const order = e.currentTarget.dataset.order || {}
    const orderId = order.id || (order.raw && order.raw.id)
    if (!orderId) return
    request.post('/errand/' + orderId + '/pay', {}, true, { idempotencyKey: 'errand_repay_' + orderId }).then((payment) => {
      return new Promise((resolve, reject) => wx.requestPayment({ ...payment, success: resolve, fail: reject }))
    }).then(() => {
      wx.showToast({ title: '支付成功，正在确认', icon: 'success' })
      this._mineCache = { published: null, accepted: null }
      setTimeout(() => this.loadCurrentTab(), 1000)
    }).catch((error) => {
      const message = String((error && (error.errMsg || error.message)) || '')
      if (/cancel/.test(message)) wx.showToast({ title: '已取消支付', icon: 'none' })
    })
  },

  onFinish(e) {
    const order = e.currentTarget.dataset.order || {}
    const orderId = order.id || (order.raw && order.raw.id)
    if (!orderId) return
    wx.navigateTo({ url: '/pages/errand-complete/index?id=' + orderId })
  },

  onCancelOrder(e) {
    const order = e.currentTarget.dataset.order || {}
    const orderId = order.id || (order.raw && order.raw.id)
    if (!orderId) return
    wx.navigateTo({ url: '/pages/errand-cancel/index?id=' + orderId })
  },

  onContact(e) {
    const order = e.currentTarget.dataset.order || {}
    const raw = order.raw || {}
    const accepterId = Number(raw.accepterId || raw.accepter_id || raw.acceptorId || raw.acceptor_id || 0)
    if (!accepterId) {
      wx.showToast({ title: '对方暂未接单，暂无法联系', icon: 'none' })
      return
    }
    const otherUser = {
      id: accepterId,
      nickname: raw.accepterName || raw.accepter_name || '接单者',
      avatar: '/assets/icons/avatar.png'
    }
    wx.navigateTo({
      url: '/pages/chat/index?peerId=' + accepterId + '&otherUser=' + encodeURIComponent(JSON.stringify(otherUser))
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

  goUserCenter() {
    if (!auth.requireLogin('查看订单需要先登录')) return
    wx.navigateTo({ url: '/pages/errand-order/index' })
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
