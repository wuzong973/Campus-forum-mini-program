const auth = require('../../utils/auth')
const request = require('../../utils/request')
const format = require('../../utils/format')
const { runPullDownRefresh } = require('../../utils/refresh')

// 状态文案（与接单大厅保持一致）
const STATUS_TEXT = {
  pending: '待接单',
  accepted: '进行中',
  done: '已完成',
  unpaid: '待支付',
  cancelled: '已取消',
  refunding: '退款中'
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    // 统计
    counts: { unpaid: 0, pending: 0, inProgress: 0, done: 0, cancelled: 0 },
    // 收益卡片（与"我的"钱包数据互通）
    wallet: { balance: '0.00', earned: '0.00' },
    // 标签
    tabs: ['我发布的', '我接的单'],
    activeTab: 0,
    // 状态筛选
    statusFilters: ['待支付', '待接单', '待完成', '已完成', '已取消'],
    activeStatus: 0,
    orders: [],
    emptyText: '当前标签下暂无订单'
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.refresh())
  },

  refresh() {
    this.loadWallet()
    this._loadFromServer()
  },

  // 收益卡片数据：与钱包页共用 /wallet/summary，提现只能在钱包页发起
  loadWallet() {
    if (!auth.isLoggedIn()) return
    const apply = (data) => {
      if (!data) return
      this.setData({
        wallet: {
          balance: Number(data.available || 0).toFixed(2),
          earned: Number(data.earned || 0).toFixed(2)
        }
      })
    }
    request.get('/wallet/summary', {}, true, { silent: true }).then(apply).catch(() => {})
  },

  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/index' })
  },

  _loadFromServer() {
    const isPublished = this.data.activeTab === 0
    // 获取我的所有订单（发布+接单）
    Promise.all([
      request.get('/errand/my-published', {}, true, { silent: true }),
      request.get('/errand/my-accepted', {}, true, { silent: true })
    ]).then(([publishedRes, acceptedRes]) => {
      const published = (publishedRes && publishedRes.list) || []
      const accepted = (acceptedRes && acceptedRes.list) || []
      const list = isPublished ? published : accepted

      const counts = { unpaid: 0, pending: 0, done: 0, inProgress: 0, cancelled: 0 }
      const all = [...published, ...accepted]
      all.forEach((o) => {
        const status = this.effectiveStatus(o, Number(o.publisher_id || o.publisherId) > 0)
        if (status === 'unpaid') counts.unpaid++
        else if (status === 'pending') counts.pending++
        else if (o.status === 'accepted') counts.inProgress++
        else if (o.status === 'finished') counts.done++
        else if (o.status === 'cancelled') counts.cancelled++
      })

      const statusMap = ['unpaid', 'pending', 'accepted', 'finished', 'cancelled']
      const target = statusMap[this.data.activeStatus]
      const filtered = target ? list.filter((o) => this.effectiveStatus(o, isPublished) === target) : list

      this.setData({
        counts,
        orders: filtered.map((o) => this.normalizeOrder(o)),
        emptyText: isPublished ? '还没有发布的订单' : '还没有接过的订单'
      })
    }).catch(() => {
      this.setData({ orders: [], emptyText: '加载失败' })
    })
  },

  normalizeOrder(o) {
    const isPublished = this.data.activeTab === 0
    const effectiveStatus = this.effectiveStatus(o, isPublished)
    const paymentStatus = String(o.paymentStatus || o.payment_status || 'SUCCESS').toUpperCase()
    const statusClass = o.status === 'cancelled' && paymentStatus === 'REFUNDING' ? 'refunding' : (effectiveStatus === 'finished' ? 'done' : effectiveStatus)
    // 性别限制标签分类（与接单大厅一致）
    const genderRaw = o.gender_requirement || o.genderRequirement || ''
    const genderClass = genderRaw === '限男生' ? 'male' : (genderRaw === '限女生' ? 'female' : 'any')
    const expectText = o.expectTime || o.expect_time || o.appointmentTime ||
      (o.pickupTimeType === 'scheduled' && (o.pickupTime || o.pickup_time) ? (o.pickupTime || o.pickup_time) : '越快越好')
    return {
      id: o.id,
      // 与接单大厅相同的卡片版式：头像+昵称+校区/性别标签+状态胶囊 / 公开描述+红色金额 / 期望完成时间
      statusText: STATUS_TEXT[statusClass] || '待接单',
      statusClass,
      price: o.reward || o.totalAmount,
      descText: (o.remark || o.description || o.desc || o.title || ((o.type || '快递') + '代拿')).trim(),
      campus: o.campus || '',
      genderText: genderRaw,
      genderClass,
      authorName: o.publisher_name || o.publisherName || '校园用户',
      avatarUrl: o.publisher_avatar || o.publisherAvatar || '/assets/icons/avatar.png',
      expectText,
      publishTime: format.formatRelativeTime(o.createdAt || o.created_at) || '刚刚',
      role: o.role || (isPublished ? 'publisher' : 'accepter'),
      publisherId: o.publisherId || o.publisher_id || 0,
      accepterId: o.accepterId || o.accepter_id || o.acceptorId || o.acceptor_id || 0,
      action: this.cardAction(statusClass, isPublished),
      raw: o
    }
  },

  // 各标签下的主操作按钮（与接单大厅"我发布的/我接的单"逻辑一致）
  cardAction(statusKey, isPublished) {
    if (isPublished) {
      if (statusKey === 'unpaid') return 'pay'
      if (statusKey === 'pending') return 'cancel'
      if (statusKey === 'accepted') return 'contact'
      return ''
    }
    return statusKey === 'accepted' ? 'finish' : ''
  },

  effectiveStatus(o, isPublished) {
    const paymentStatus = String(o.paymentStatus || o.payment_status || 'SUCCESS').toUpperCase()
    if (isPublished && o.status === 'pending' && !['SUCCESS', 'REFUNDING', 'REFUNDED'].includes(paymentStatus)) return 'unpaid'
    return o.status || 'pending'
  },

  goBack() {
    wx.navigateBack()
  },

  onTab(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.activeTab) return
    this.setData({ activeTab: index, activeStatus: 0 })
    this.refresh()
  },

  onStatusFilter(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ activeStatus: index })
    this.refresh()
  },

  onPay(e) {
    const order = e.currentTarget.dataset.order || {}
    if (!order.id || order.statusClass !== 'unpaid') return
    request.post('/errand/' + order.id + '/pay', {}, true, { idempotencyKey: 'errand_repay_' + order.id }).then((payment) => {
      return new Promise((resolve, reject) => wx.requestPayment({ ...payment, success: resolve, fail: reject }))
    }).then(() => {
      wx.showToast({ title: '支付成功，正在确认', icon: 'success' })
      setTimeout(() => this.refresh(), 1000)
    }).catch((error) => {
      const message = String((error && (error.errMsg || error.message)) || '')
      if (/cancel/.test(message)) wx.showToast({ title: '已取消支付', icon: 'none' })
    })
  },

  onOpenDetail(e) {
    const order = e.currentTarget.dataset.order || {}
    if (!order.id) return
    wx.navigateTo({ url: '/pages/errand-detail/index?id=' + order.id })
  },

  onFinish(e) {
    const order = e.currentTarget.dataset.order || {}
    if (order && order.id) {
      wx.navigateTo({ url: '/pages/errand-complete/index?id=' + order.id })
    }
  },

  onContact(e) {
    const order = e.currentTarget.dataset.order || {}
    const raw = order.raw || {}
    const peerId = Number(order.role === 'publisher'
      ? (order.accepterId || raw.accepterId || raw.accepter_id || 0)
      : (order.publisherId || raw.publisherId || raw.publisher_id || 0))
    if (!peerId) {
      wx.showToast({ title: '对方暂未接单，暂无法联系', icon: 'none' })
      return
    }
    // 进入跑腿订单专属聊天（与私信聊天独立）
    wx.navigateTo({ url: '/pages/errand-chat/index?orderId=' + order.id })
  },

  onCancel(e) {
    const order = e.currentTarget.dataset.order || {}
    if (order && order.id) {
      const roleParam = order.role === 'publisher' ? '&role=publisher' : ''
      wx.navigateTo({ url: '/pages/errand-cancel/index?id=' + order.id + roleParam })
    }
  },

  goPublish() {
    if (!auth.requireLogin('发布跑腿需要先登录')) return
    wx.navigateTo({ url: '/pages/errand-publish/index' })
  },

  // ===== 右下角浮动导航 =====
  goMessages() {
    if (!auth.requireLogin('查看跑腿消息需要先登录')) return
    wx.navigateTo({ url: '/pages/errand-message/index' })
  },

  goHallHome() {
    wx.switchTab({ url: '/pages/errand/index' })
  },

  // 底部Tab切换
  onSubTab(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === 0) {
      wx.redirectTo({ url: '/pages/errand/index' })
    } else if (index === 1) {
      if (!auth.requireLogin('发布跑腿需要先登录')) return
      wx.navigateTo({ url: '/pages/errand-publish/index' })
    }
  }
})
