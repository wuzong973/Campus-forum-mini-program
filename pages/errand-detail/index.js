const auth = require('../../utils/auth')
const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

// 订单信息统一使用 YYYY-MM-DD HH:mm:ss 展示（与订单编号的紧凑时间规则一致）
function toDashText(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

// 期望完成时间为手动填写的自由文本：能解析成时间则格式化，否则原样展示
function toAppointmentText(value) {
  if (!value) return ''
  return toDashText(value) || String(value)
}

// 订单记录动作 → 展示文案（与后端 errand_order_log.action 对应）
const LOG_LABELS = {
  created: '发布订单，等待同学接单',
  accepted: '同学接单，订单进行中',
  cancel_requested: '接单方申请取消接单，等待发单人处理',
  cancel_approved: '发单人同意取消接单，订单已终止，赏金原路退回',
  cancel_rejected: '发单人拒绝取消接单，订单继续进行',
  self_cancel: '接单方因自身原因取消接单，订单已终止，赏金原路退回',
  finished: '订单完成',
  cancelled: '发布者取消订单，赏金原路退回'
}

const STATUS_TEXT = {
  pending: '待接单 ···',
  accepted: '进行中 ···',
  finished: '已完成',
  cancelled: '已取消'
}

const PUBLISHER_AVATARS = ['👨🏻', '👩🏻', '🧑🏻', '👨🏼', '👩🏼', '🧑🏼']

Page({
  data: {
    id: '',
    order: null,
    loading: true,
    canViewRemark: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    statusText: '',
    bottomMode: '', // acceptor / publisher / ownerPending / pending / finished / ''
    requestPending: false,
    canHandleRequest: false,
    cancelRequest: null,
    logs: [],
    showLogs: false,
    guideStep: 0,
    accepting: false,
    showReview: false,
    reviewRating: 5,
    reviewContent: '',
    reviewing: false
  },

  onLoad(options) {
    if (!auth.requireLogin('查看订单详情需要先登录')) {
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    const app = getApp()
    this.setData({
      id: options.id || '',
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    })
    this.loadOrder()
  },

  onShow() {
    // 从取消接单/提交完成页返回时刷新订单状态
    if (this._entered) this.loadOrder()
    this._entered = true
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadOrder())
  },

  goBack() {
    wx.navigateBack()
  },

  loadOrder() {
    if (!this.data.id) return
    this.setData({ loading: true })
    if (request.USE_MOCK) {
      const mock = require('../../utils/mock')
      const published = mock.myPublishedOrders.find((item) => String(item.id) === String(this.data.id))
      const accepted = mock.myAcceptedOrders.find((item) => String(item.id) === String(this.data.id))
      const order = published || accepted || mock.errandOrders.find((item) => String(item.id) === String(this.data.id))
      this.applyOrder(this.normalizeOrder(order), null, !!(published || accepted))
      return
    }
    request.get('/errand/' + this.data.id, {}, true).then((data) => {
      this.applyOrder(this.normalizeOrder(data.order), data.cancelRequest || null, !!data.canViewRemark)
    }).catch(() => this.setData({ loading: false }))
  },

  applyOrder(order, cancelRequest, canViewRemark) {
    const status = order ? order.status : ''
    const role = order ? order.role : 'viewer'
    const requestPending = !!(cancelRequest && cancelRequest.status === 'pending' && status === 'accepted')
    let bottomMode = ''
    if (status === 'accepted') bottomMode = role === 'acceptor' ? 'acceptor' : (role === 'publisher' ? 'publisher' : '')
    else if (status === 'pending') bottomMode = role === 'publisher' ? 'ownerPending' : (role === 'viewer' ? 'pending' : '')
    else if (status === 'finished') bottomMode = 'finished'
    const guideStep = status === 'pending' ? 1 : (status === 'accepted' ? 3 : (status === 'finished' ? 4 : 0))
    this.setData({
      order,
      cancelRequest,
      canViewRemark,
      loading: false,
      statusText: STATUS_TEXT[status] || '',
      bottomMode,
      guideStep,
      requestPending,
      canHandleRequest: requestPending && role === 'publisher'
    })
  },

  normalizeOrder(order) {
    if (!order) return null
    const appointmentTime = order.appointmentTime || order.appointment_time || ''
    const createdText = toDashText(order.createdAt || order.created_at)
    const acceptedRaw = order.acceptedAt || order.accepted_at
    const finishedRaw = order.finishedAt || order.finished_at
    const contactPhone = order.contact_phone || ''
    const finishImages = order.finishImages || order.finish_images || []
    // 订单编号：按图四版式 “e + 下单时间 + 订单id” 展示
    const orderNo = 'e' + String(createdText).replace(/\D/g, '') + order.id
    const reward = Number(order.reward || order.totalAmount || 0)
    const publisherId = Number(order.publisherId || order.publisher_id || 0)
    // 发单人真实头像与昵称（服务端 JOIN sys_user 返回；账号注销等缺失时兜底匿名形象）
    const publisherName = order.publisher_name || order.publisherName || ('神秘同学' + publisherId)
    const publisherAvatarUrl = order.publisher_avatar || order.publisherAvatar || ''
    // mock 数据历史拼写为 accepter，统一归一化为后端的 acceptor
    const role = order.role === 'publisher' ? 'publisher' : (order.role === 'acceptor' || order.role === 'accepter' ? 'acceptor' : 'viewer')
    return Object.assign({}, order, {
      role,
      rewardText: reward ? reward.toFixed(2) : '0.00',
      publisherEmoji: PUBLISHER_AVATARS[publisherId % PUBLISHER_AVATARS.length],
      publisherAvatar: publisherAvatarUrl,
      publisherName,
      pickupAddr: order.pickupAddr || order.pickup_addr || '',
      deliveryAddr: order.deliveryAddr || order.delivery_addr || '',
      receiverName: order.receiverName || order.receiver_name || '',
      receiverPhone: order.receiverPhone || order.receiver_phone || '',
      deliveryBuilding: order.deliveryBuilding || order.delivery_building || '',
      deliveryRoom: order.deliveryRoom || order.delivery_room || '',
      description: order.description || order.desc || '',
      genderRequirement: order.genderRequirement || order.gender_requirement || '',
      pickupTimeType: order.pickupTimeType || order.pickup_time_type || '尽快',
      appointmentText: toAppointmentText(appointmentTime),
      createdText,
      acceptedText: toDashText(acceptedRaw),
      finishedText: toDashText(finishedRaw),
      orderNoText: orderNo,
      contactPhone,
      finishImages: Array.isArray(finishImages) ? finishImages : [],
      isOwner: order.role === 'publisher'
    })
  },

  onAccept() {
    const order = this.data.order
    if (!order || order.status !== 'pending' || this.data.accepting) return
    wx.showModal({
      title: '确认接单',
      content: '接单后请尽快完成订单，30分钟内因自身原因可直接取消接单。',
      success: (result) => {
        if (!result.confirm) return
        this.setData({ accepting: true })
        if (request.USE_MOCK) {
          order.status = 'accepted'
          order.role = 'acceptor'
          this.setData({ order, canViewRemark: true, accepting: false })
          wx.showToast({ title: '接单成功', icon: 'success' })
          return
        }
        request.post('/errand/' + order.id + '/accept', {}, true).then(() => {
          wx.showToast({ title: '接单成功', icon: 'success' })
          this.loadOrder()
        }).finally(() => this.setData({ accepting: false }))
      }
    })
  },

  openComplete() {
    if (this.data.requestPending) {
      wx.showToast({ title: '取消申请处理中，请耐心等待', icon: 'none' })
      return
    }
    if (this.data.order && this.data.order.id) wx.navigateTo({ url: '/pages/errand-complete/index?id=' + this.data.order.id })
  },

  openCancel() {
    if (this.data.order && this.data.order.id) wx.navigateTo({ url: '/pages/errand-cancel/index?id=' + this.data.order.id })
  },

  openCancelPublisher() {
    if (this.data.order && this.data.order.id) wx.navigateTo({ url: '/pages/errand-cancel/index?id=' + this.data.order.id + '&role=publisher' })
  },

  onContact() {
    const order = this.data.order
    if (!order) return
    // 尚未接单的浏览者：聊天仅限接单人与发单人，引导先接单
    if (order.role !== 'publisher' && order.role !== 'acceptor' && order.status === 'pending') {
      wx.showToast({ title: '接单后即可与发单人沟通', icon: 'none' })
      return
    }
    // 进入跑腿订单专属聊天（双方真实身份，与私信/匿名聊天完全独立）
    if (order.id) wx.navigateTo({ url: '/pages/errand-chat/index?orderId=' + order.id })
  },

  copyOrderNo() {
    const order = this.data.order
    if (!order) return
    wx.setClipboardData({
      data: order.orderNoText,
      success: () => wx.showToast({ title: '订单编号已复制', icon: 'none' })
    })
  },

  previewFinishImage(e) {
    const current = e.currentTarget.dataset.src
    if (!current) return
    wx.previewImage({ current, urls: this.data.order.finishImages })
  },

  openLogs() {
    if (request.USE_MOCK) {
      const order = this.data.order
      const logs = []
      if (order) {
        logs.push({ id: 1, text: LOG_LABELS.created, timeText: order.createdText })
        if (order.acceptedText) logs.push({ id: 2, text: LOG_LABELS.accepted, timeText: order.acceptedText })
        if (order.finishedText) logs.push({ id: 3, text: LOG_LABELS.finished, timeText: order.finishedText })
      }
      this.setData({ logs, showLogs: true })
      return
    }
    request.get('/errand/' + this.data.id + '/logs', {}, true).then((data) => {
      const list = (data && data.list) || []
      this.setData({
        logs: list.map((item) => ({
          id: item.id,
          text: (item.actor_name ? item.actor_name + '　' : '') + (LOG_LABELS[item.action] || item.detail || item.action),
          timeText: toDashText(item.created_at)
        })),
        showLogs: true
      })
    }).catch(() => wx.showToast({ title: '订单记录加载失败', icon: 'none' }))
  },

  closeLogs() {
    this.setData({ showLogs: false })
  },

  // 发单人处理取消接单申请
  respondRequest(e) {
    const request_ = this.data.cancelRequest
    if (!request_ || !this.data.canHandleRequest) return
    const approve = e.currentTarget.dataset.approve === '1'
    wx.showModal({
      title: approve ? '同意取消接单' : '拒绝取消接单',
      content: approve ? '同意后订单将终止，赏金将按原支付路径退回给你。' : '拒绝后订单继续进行，该同学需按要求完成订单。',
      cancelText: '再想想',
      confirmText: approve ? '同意取消' : '确认拒绝',
      confirmColor: approve ? '#347ff2' : '#ee4444',
      success: (r) => {
        if (!r.confirm) return
        request.post('/errand/cancel-requests/' + request_.id + '/review', { approve }, true).then(() => {
          wx.showToast({ title: approve ? '已同意取消接单' : '已拒绝该申请', icon: 'success' })
          this.loadOrder()
        }).catch(() => {})
      }
    })
  },

  previewRequestImage(e) {
    const request_ = this.data.cancelRequest
    const current = e.currentTarget.dataset.src
    if (!request_ || !current) return
    const urls = Array.isArray(request_.images) ? request_.images : []
    if (!urls.length) return
    wx.previewImage({ current, urls })
  },

  noop() {},

  openReview() {
    this.setData({ showReview: true })
  },

  closeReview() {
    if (!this.data.reviewing) this.setData({ showReview: false })
  },

  chooseRating(e) {
    this.setData({ reviewRating: Number(e.currentTarget.dataset.rating) })
  },

  onReviewInput(e) {
    this.setData({ reviewContent: e.detail.value })
  },

  submitReview() {
    const order = this.data.order
    if (!order || this.data.reviewing) return
    if (request.USE_MOCK) {
      wx.showToast({ title: '演示模式暂不支持评价', icon: 'none' })
      return
    }
    this.setData({ reviewing: true })
    request.post('/errand/' + order.id + '/review', {
      rating: this.data.reviewRating,
      content: this.data.reviewContent.trim()
    }, true).then(() => {
      wx.showToast({ title: '评价成功', icon: 'success' })
      this.setData({ showReview: false, reviewContent: '' })
    }).finally(() => this.setData({ reviewing: false }))
  },

  // 右侧浮动导航
  goPublish() {
    if (!auth.requireLogin('发布跑腿需要先登录')) return
    wx.navigateTo({ url: '/pages/errand-publish/index' })
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/errand-message/index' })
  },

  goHallHome() {
    wx.switchTab({ url: '/pages/errand/index' })
  }
})
