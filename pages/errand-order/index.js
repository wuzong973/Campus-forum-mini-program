const auth = require('../../utils/auth')
const request = require('../../utils/request')
const format = require('../../utils/format')
const { runPullDownRefresh } = require('../../utils/refresh')
const liquidTab = require('../../utils/liquid-tab')

// 截止接单时间 → 卡片紧凑文案「M月D日 HH:mm」（服务端 DATETIME 可能序列化为 UTC ISO 串，
// 统一 new Date 解析后按本地时区格式化；不可解析返回 ''）
function formatDeadlineText(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// 公开描述清理：去掉历史数据以快捷标签插入的「期望完成时间：」前缀，避免与卡片独立的
// 期望时间字段重复；清理后为空则回退 fallback
function cleanDescText(text, fallback) {
  const cleaned = String(text || '').replace(/^\s*(期望完成时间|期望时间)[:：]\s*/i, '').trim()
  return cleaned || fallback
}

// 状态文案（与接单大厅保持一致）
const STATUS_TEXT = {
  pending: '待接单',
  accepted: '进行中',
  finishing: '待确认',
  disputed: '有异议',
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
    // 液态指示条（utils/liquid-tab.js）
    liquidStyle: '',
    liquidPhase: '',
    // 状态筛选
    statusFilters: ['待支付', '待接单', '待完成', '已完成', '已取消'],
    activeStatus: 0,
    orders: [],
    emptyText: '当前标签下暂无订单',
    needLogin: false
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    // 液态标签指示条：初始落位（无动画），布局稳定后测量
    this.liquidTab = liquidTab.create(this, {
      track: '.top-tabs',
      items: '.top-tab',
      indicator: '.liquid-indicator'
    })
    wx.nextTick(() => this.liquidTab.snap(this.data.activeTab))
    this.refresh()
  },

  onUnload() {
    if (this.liquidTab) this.liquidTab.destroy()
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
    wx.navigateTo({ url: '/pkg-feature/pages/wallet/index' })
  },

  goLogin() {
    auth.requireLogin('查看订单需要先登录')
  },

  _loadFromServer() {
    // 未登录直接给出登录引导，而不是把 401 静默失败渲染成「加载失败」
    if (!auth.isLoggedIn()) {
      this.setData({
        orders: [],
        emptyText: '登录后即可查看你发布和接取的订单',
        needLogin: true
      })
      return
    }
    if (this.data.needLogin) this.setData({ needLogin: false })
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
        // 待确认（接单方已提交完成）与有异议（客服介入中）都属于「待完成」
        else if (['accepted', 'finishing', 'disputed'].indexOf(o.status) > -1) counts.inProgress++
        else if (o.status === 'finished') counts.done++
        else if (o.status === 'cancelled') counts.cancelled++
      })

      const statusMap = ['unpaid', 'pending', 'accepted', 'finished', 'cancelled']
      const target = statusMap[this.data.activeStatus]
      const filtered = target ? list.filter((o) => this.filterKey(o, isPublished) === target) : list

      this.setData({
        counts,
        orders: filtered.map((o) => this.normalizeOrder(o)),
        emptyText: isPublished ? '还没有发布的订单' : '还没有接过的订单'
      })
    }).catch((error) => {
      if (error && error.requiresLogin) {
        this.setData({ orders: [], emptyText: '登录已过期，请重新登录', needLogin: true })
        return
      }
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
    // 期望时间：发单人填写，未填写显示「越快越好」；截止时间为另一个独立字段
    const expectText = o.appointmentTime || o.appointment_time ||
      (o.pickupTimeType === 'scheduled' && (o.pickupTime || o.pickup_time) ? (o.pickupTime || o.pickup_time) : '') || '越快越好'
    const deadlineText = formatDeadlineText(o.acceptDeadline || o.accept_deadline)
    const descFallback = (o.title || ((o.type || '快递') + '代拿')).trim()
    return {
      id: o.id,
      // 与接单大厅相同的卡片版式：头像+昵称+校区/性别标签+状态胶囊 / 公开描述+红色金额 / 期望+截止时间
      statusText: STATUS_TEXT[statusClass] || '待接单',
      statusClass,
      price: o.reward || o.totalAmount,
      descText: cleanDescText(o.remark || o.description || o.desc || o.title || ((o.type || '快递') + '代拿'), descFallback),
      campus: o.campus || '',
      genderText: genderRaw,
      genderClass,
      authorName: o.publisher_name || o.publisherName || '校园用户',
      avatarUrl: o.publisher_avatar || o.publisherAvatar || '/assets/icons/avatar.png',
      expectText,
      deadlineText,
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
      // 接单方已提交完成，发单人需进详情确认完成或提出异议
      if (statusKey === 'finishing') return 'confirm'
      return ''
    }
    return statusKey === 'accepted' ? 'finish' : ''
  },

  effectiveStatus(o, isPublished) {
    const paymentStatus = String(o.paymentStatus || o.payment_status || 'SUCCESS').toUpperCase()
    if (isPublished && o.status === 'pending' && !['SUCCESS', 'REFUNDING', 'REFUNDED'].includes(paymentStatus)) return 'unpaid'
    return o.status || 'pending'
  },

  // 状态筛选归并：待确认/有异议归入「待完成」，避免这两个新状态在筛选下凭空消失
  filterKey(o, isPublished) {
    const status = this.effectiveStatus(o, isPublished)
    return status === 'finishing' || status === 'disputed' ? 'accepted' : status
  },

  goBack() {
    wx.navigateBack()
  },

  onTab(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.activeTab) return
    this.setData({ activeTab: index, activeStatus: 0 })
    this.liquidTab.moveTo(index)
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
      // 接单大厅是 tabBar 页面，redirectTo/navigateTo 均不支持，必须用 switchTab
      wx.switchTab({ url: '/pages/errand/index' })
    } else if (index === 1) {
      if (!auth.requireLogin('发布跑腿需要先登录')) return
      wx.navigateTo({ url: '/pages/errand-publish/index' })
    }
  }
})
