const auth = require('../../utils/auth')
const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

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
    if (!request.USE_MOCK) {
      this._loadFromServer()
    } else {
      this._loadFromMock()
    }
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
    if (request.USE_MOCK) {
      apply(require('../../utils/mock').walletSummary)
      return
    }
    request.get('/wallet/summary', {}, true, { silent: true }).then(apply).catch(() => {})
  },

  goWallet() {
    wx.navigateTo({ url: '/pages/wallet/index' })
  },

  _loadFromMock() {
    const mock = require('../../utils/mock')
    const published = mock.myPublishedOrders.slice()
    const accepted = mock.myAcceptedOrders.slice()
    const isPublished = this.data.activeTab === 0
    const list = isPublished ? published : accepted

    const counts = { unpaid: 0, pending: 0, inProgress: 0, done: 0, cancelled: 0 }
    const all = [...mock.myPublishedOrders, ...mock.myAcceptedOrders]
    all.forEach((o) => {
      const status = this.effectiveStatus(o, Number(o.publisherId || o.publisher_id) > 0)
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
    const timeLimit = o.pickupTimeType || o.pickup_time_type || '尽快'
    const genderReq = o.genderRequirement || o.gender_requirement || o.genderReq || '不限性别'
    const isLargeItem = o.isLargeItem || o.is_large_item || false
    const isUrgent = o.isUrgent || o.is_urgent || false
    const extraTags = []
    if (isLargeItem) extraTags.push('大件')
    if (isUrgent) extraTags.push('加急')
    const isPublished = this.data.activeTab === 0
    const effectiveStatus = this.effectiveStatus(o, isPublished)
    const paymentStatus = String(o.paymentStatus || o.payment_status || 'SUCCESS').toUpperCase()
    const statusClass = o.status === 'cancelled' && paymentStatus === 'REFUNDING' ? 'refunding' : (effectiveStatus === 'finished' ? 'done' : effectiveStatus)
    return {
      id: o.id,
      type: o.type || '快递',
      title: o.title || ((o.type || '快递') + '代拿'),
      desc: o.desc || o.description,
      reward: o.reward || o.totalAmount,
      pickupAddr: o.pickupAddr || o.pickup_addr || '',
      deliveryAddr: o.deliveryAddr || o.delivery_addr || '',
      campus: o.campus || '未填写校区',
      status: effectiveStatus === 'finished' ? 'done' : effectiveStatus,
      statusClass,
      paymentStatus,
      publisherName: o.publisherName || o.publisher_name || '',
      accepterName: o.accepterName || o.accepter_name || '',
      publisherId: o.publisherId || o.publisher_id || 0,
      accepterId: o.accepterId || o.accepter_id || o.acceptorId || o.acceptor_id || 0,
      role: o.role || (this.data.activeTab === 0 ? 'publisher' : 'accepter'),
      createdAt: o.createdAt || o.created_at,
      acceptedAt: o.acceptedAt || o.accepted_at,
      itemCount: o.itemCount || 1,
      timeLimit: timeLimit,
      genderReq: genderReq,
      noUpstairs: false,
      extraTags: extraTags,
      raw: o
    }
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

  onAccept(e) {
    const order = e.detail.order
    if (!auth.requireLogin('操作需要先登录')) return
    wx.showModal({
      title: '确认接单',
      content: '确定接受此订单？',
      success: (res) => {
        if (!res.confirm) return
        if (request.USE_MOCK) {
          order.status = 'accepted'
          order.role = 'accepter'
          order.acceptedAt = new Date().toISOString()
          this.refresh()
          wx.showToast({ title: '接单成功', icon: 'success' })
        } else {
          request.post('/errand/' + order.id + '/accept', {}, true).then(() => {
            wx.showToast({ title: '接单成功', icon: 'success' })
            this.refresh()
          }).catch(() => {})
        }
      }
    })
  },

  onPay(e) {
    const order = e.detail.order
    if (!order || order.status !== 'unpaid') return
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
    const order = e.detail.order || {}
    if (!order.id) return
    wx.navigateTo({ url: '/pages/errand-detail/index?id=' + order.id })
  },

  onFinish(e) {
    const order = e.detail.order
    if (order && order.id) {
      wx.navigateTo({ url: '/pages/errand-complete/index?id=' + order.id })
      return
    }
    if (request.USE_MOCK) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera'],
        success: (res) => {
          const photoPath = res.tempFiles[0].tempFilePath
          wx.showModal({
            title: '确认完成',
            content: '送达照片已拍摄，确认完成此订单？',
            success: (modalRes) => {
              if (!modalRes.confirm) return
              order.status = 'finished'
              order.deliveryPhoto = photoPath
              this.refresh()
              wx.showToast({ title: '订单已完成', icon: 'success' })
            }
          })
        },
        fail: () => {
          wx.showToast({ title: '需要送达照片才能完成订单', icon: 'none' })
        }
      })
    } else {
      wx.showModal({
        title: '确认完成',
        content: '确认完成此订单？',
        success: (modalRes) => {
          if (!modalRes.confirm) return
          request.post('/errand/' + order.id + '/finish', {}, true).then(() => {
            wx.showToast({ title: '订单已完成', icon: 'success' })
            this.refresh()
          }).catch(() => {})
        }
      })
    }
  },

  onContact(e) {
    const order = e.detail.order
    const peerId = order.role === 'publisher' ? order.accepterId : order.publisherId
    if (!peerId) {
      wx.showToast({ title: '对方暂未接单，暂无法联系', icon: 'none' })
      return
    }
    // 进入跑腿订单专属聊天（与私信聊天独立）
    wx.navigateTo({ url: '/pages/errand-chat/index?orderId=' + order.id })
  },

  onCancel(e) {
    const order = e.detail.order
    if (order && order.id) {
      const roleParam = order.role === 'publisher' ? '&role=publisher' : ''
      wx.navigateTo({ url: '/pages/errand-cancel/index?id=' + order.id + roleParam })
      return
    }
    if (request.USE_MOCK) {
      if (order.role === 'accepter') {
        const acceptedAt = order.acceptedAt || order.createdAt
        const elapsed = Date.now() - new Date(acceptedAt).getTime()
        if (elapsed >= 5 * 60 * 1000) {
          wx.showModal({
            title: '无法取消',
            content: '接单已超过5分钟，请联系发布者让发布者取消订单',
            confirmText: '去联系',
            success: (res) => {
              if (res.confirm) {
                wx.navigateTo({ url: '/pages/errand-chat/index?orderId=' + order.id })
              }
            }
          })
          return
        }
      }
      wx.showModal({
        title: '确认取消',
        content: '确定要取消此订单吗？',
        confirmText: '确认取消',
        confirmColor: '#ee4444',
        success: (res) => {
          if (!res.confirm) return
          order.status = 'cancelled'
          this.refresh()
          wx.showToast({ title: '订单已取消', icon: 'success' })
        }
      })
    } else {
      wx.showModal({
        title: '确认取消',
        content: '确定要取消此订单吗？',
        confirmText: '确认取消',
        confirmColor: '#ee4444',
        success: (res) => {
          if (!res.confirm) return
          request.post('/errand/' + order.id + '/cancel', {}, true, { idempotencyKey: 'errand_cancel_' + order.id }).then((data) => {
            wx.showToast({ title: data && data.refundStatus ? '订单已取消，退款处理中' : '订单已取消', icon: 'success' })
            this.refresh()
          }).catch(() => {})
        }
      })
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
