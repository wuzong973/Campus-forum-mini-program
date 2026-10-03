const auth = require('../../utils/auth')
const request = require('../../utils/request')
const qr = require('../../utils/qr')
const { runPullDownRefresh } = require('../../utils/refresh')
const errandStatus = require('../../utils/errand-status')

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
  cancelled: '发布者取消订单，赏金原路退回',
  timeout_cancelled: '订单超时，系统自动取消',
  deadline_cancelled: '超过截止接单时间，系统自动取消，赏金原路退回'
}

const STATUS_TEXT = {
  pending: '待接单 ···',
  accepted: '进行中 ···',
  finishing: '待确认 ···',
  disputed: '有异议 ···',
  finished: '已完成',
  cancelled: '已取消'
}

// 接单方提交完成后，发单人需在 2 小时内确认；逾期既未确认也未提出异议时由系统自动确认完成
const AUTO_CONFIRM_HOURS = 2

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
    canViewLogs: false,
    canContact: false,
    cancelRequest: null,
    logs: [],
    showLogs: false,
    guideStep: 0,
    accepting: false,
    showReview: false,
    reviewRating: 5,
    reviewContent: '',
    reviewing: false,
    showContactSheet: false,
    contactPhoneText: '',
    // 进行中的订单（非发单人非接单人）打开时提示「已被接走」并引导返回接单大厅
    showTakenPopup: false,
    takenAcceptorName: '',
    takenAcceptorAvatar: '',
    // 发单人查看接单方提交完成的详情弹窗（含确认完成 / 拒绝并提异议入口）
    showSubmitSheet: false,
    // 异议填写弹窗
    showDisputeSheet: false,
    disputeContent: '',
    disputing: false,
    confirming: false,
    // 待确认状态下的等待时长（HH:mm:ss，每秒刷新）
    waitText: '00:00:00',
    autoConfirmHours: AUTO_CONFIRM_HOURS
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

  onUnload() {
    // 待确认等待计时器：页面销毁时清理，避免后台持续 setData
    this.stopWaitTimer()
  },

  goBack() {
    wx.navigateBack()
  },

  loadOrder() {
    if (!this.data.id) return
    this.setData({ loading: true })
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
    else if (status === 'finishing') {
      // 接单方已提交完成：发单人看到「提出异议 / 确认完成」，接单方等待发单人确认
      bottomMode = role === 'publisher' ? 'publisherConfirm' : (role === 'acceptor' ? 'acceptorFinishing' : '')
    } else if (status === 'disputed') {
      bottomMode = role === 'publisher' ? 'disputedPublisher' : (role === 'acceptor' ? 'disputedAcceptor' : '')
    }     else if (status === 'pending') bottomMode = role === 'publisher' ? 'ownerPending' : (role === 'viewer' ? 'pending' : '')
    // 已完成：只有接单人能去评价（此前未判角色，浏览者也会看到「到手佣金 / 去评价」）
    else if (status === 'finished') bottomMode = role === 'viewer' ? '' : 'finished'
    const guideStep = status === 'pending' ? 1
      : (status === 'accepted' || status === 'finishing' || status === 'disputed' ? 3 : (status === 'finished' ? 4 : 0))
    // 浏览者点开已被他人接走的订单：仅首次进入时弹窗引导返回大厅，避免刷新反复打扰。
    // 待确认/有异议同属「已被接走」，一并引导 —— 否则第三方会停在别人的交接阶段页面上
    const showTaken = (status === 'accepted' || status === 'finishing' || status === 'disputed')
      && role === 'viewer' && !this._takenPrompted
    if (showTaken) this._takenPrompted = true
    this.setData({
      order,
      cancelRequest,
      canViewRemark,
      loading: false,
      statusText: STATUS_TEXT[status] || '',
      bottomMode,
      guideStep,
      requestPending,
      canHandleRequest: requestPending && role === 'publisher',
      // 订单流水与联系方式只对当事人开放（后端 /logs 对第三方直接 403）；
      // 待接单订单的浏览者保留联系入口，点了走 onContact 的「先接单」引导。
      canViewLogs: role !== 'viewer',
      canContact: role === 'publisher' || role === 'acceptor' || status === 'pending',
      contactPhoneText: this.buildContactPhoneText(order),
      showTakenPopup: showTaken,
      takenAcceptorName: (order && order.acceptorName) || '其他同学',
      takenAcceptorAvatar: (order && order.acceptorAvatar) || ''
    })
    this.startWaitTimer(order)
  },

  // 待确认状态下的「已等待」计时：以接单方提交完成时间为起点，每秒刷新一次
  startWaitTimer(order) {
    this.stopWaitTimer()
    if (!order || order.status !== 'finishing' || !order.finishSubmittedAt) return
    const base = new Date(String(order.finishSubmittedAt).replace(' ', 'T')).getTime()
    if (Number.isNaN(base)) return
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - base) / 1000))
      this.setData({ waitText: this.formatDuration(elapsed) })
    }
    tick()
    this._waitTimer = setInterval(tick, 1000)
  },

  stopWaitTimer() {
    if (this._waitTimer) {
      clearInterval(this._waitTimer)
      this._waitTimer = null
    }
  },

  formatDuration(seconds) {
    const p = (n) => String(n).padStart(2, '0')
    return p(Math.floor(seconds / 3600)) + ':' + p(Math.floor((seconds % 3600) / 60)) + ':' + p(seconds % 60)
  },

  // 电话联系文案：接单方优先拨"发单方发布订单时填写的手机号"（receiver_phone），
  // 发单人联系接单方时展示接单人注册手机号（服务端 contact_phone）
  buildContactPhoneText(order) {
    if (!order) return ''
    const phone = order.role === 'publisher'
      ? (order.contactPhone || '')
      : (order.receiverPhone || order.contactPhone || '')
    return phone ? '拨打 ' + phone : '对方暂未提供电话'
  },

  normalizeOrder(order) {
    if (!order) return null
    const appointmentTime = order.appointmentTime || order.appointment_time || ''
    const createdText = toDashText(order.createdAt || order.created_at)
    const deadlineText = toDashText(order.acceptDeadline || order.accept_deadline)
    const acceptedRaw = order.acceptedAt || order.accepted_at
    const finishedRaw = order.finishedAt || order.finished_at
    const contactPhone = order.contact_phone || ''
    const finishImages = order.finishImages || order.finish_images || []
    const orderImages = order.images || []
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
      deadlineText,
      acceptedText: toDashText(acceptedRaw),
      finishedText: toDashText(finishedRaw),
      orderNoText: orderNo,
      contactPhone,
      finishImages: Array.isArray(finishImages) ? finishImages : [],
      orderImages: Array.isArray(orderImages) ? orderImages : [],
      finishDescription: order.finish_description || order.finishDescription || '',
      finishSubmittedAt: order.finish_submitted_at || order.finishSubmittedAt || '',
      finishSubmittedText: toDashText(order.finish_submitted_at || order.finishSubmittedAt),
      // 接单方身份（发单人视角的「接单人」卡片与「已被接走」弹窗都需要）
      acceptorName: order.acceptor_name || order.acceptorName || '',
      acceptorAvatar: order.acceptor_avatar || order.acceptorAvatar || '',
      // 异议信息
      disputeReason: order.dispute_reason || order.disputeReason || '',
      disputedText: toDashText(order.disputed_at || order.disputedAt),
      disputeResult: order.dispute_result || order.disputeResult || '',
      disputeNote: order.dispute_note || order.disputeNote || '',
      disputeHandledText: toDashText(order.dispute_handled_at || order.disputeHandledAt),
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
        request.post('/errand/' + order.id + '/accept', {}, true).then(() => {
          errandStatus.publish(order.id, 'accepted')
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

  // ===== 待确认状态：查看提交详情 / 确认完成 / 提出异议 =====
  openSubmitSheet() {
    const order = this.data.order
    if (!order) return
    // 该弹窗是发给发单人核对提交结果的（内含「确认已完成」），第三方不得打开
    if (order.role !== 'publisher') return
    this.setData({ showSubmitSheet: true })
  },

  closeSubmitSheet() {
    if (this.data.confirming) return
    this.setData({ showSubmitSheet: false })
  },

  // 发单人确认完成：订单正式完成，赏金自动转入接单方钱包
  onConfirmComplete() {
    const order = this.data.order
    if (!order || this.data.confirming) return
    // 与服务端 confirm 的「仅发单人可确认完成」保持同一条口径：
    // 不在前端先把确认弹窗放出来，避免第三方点了弹窗、后端 403、界面却毫无反馈
    if (order.role !== 'publisher') return
    wx.showModal({
      title: '确认完成',
      content: '确认后订单正式完成，赏金将转入接单方钱包，且不可撤销。',
      cancelText: '再想想',
      confirmText: '确认完成',
      confirmColor: '#347ff2',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ confirming: true })
        request.post('/errand/' + order.id + '/confirm', {}, true).then(() => {
          errandStatus.publish(order.id, 'done')
          wx.showToast({ title: '订单已完成', icon: 'success' })
          this.setData({ showSubmitSheet: false })
          this.loadOrder()
        }).catch((error) => {
          // 不静默吞错：此前这里是空 catch，确认失败时用户看到的是「点了没反应」。
          // 401 已由 utils/request 统一弹过「登录已失效」，这里不重复提示。
          if (!(error && error.requiresLogin)) {
            wx.showToast({ title: (error && error.message) || '确认失败，请重试', icon: 'none' })
          }
        }).finally(() => this.setData({ confirming: false }))
      }
    })
  },

  // 拒绝提交结果并提出异议：填写异议内容后订单转「有异议」，由客服介入并推送管理后台
  openDisputeSheet() {
    if (!this.data.order) return
    this.setData({ showSubmitSheet: false, showDisputeSheet: true })
  },

  closeDisputeSheet() {
    if (this.data.disputing) return
    this.setData({ showDisputeSheet: false })
  },

  onDisputeInput(e) {
    this.setData({ disputeContent: e.detail.value })
  },

  submitDispute() {
    const order = this.data.order
    if (!order || this.data.disputing) return
    const reason = this.data.disputeContent.trim()
    if (!reason) {
      wx.showToast({ title: '请填写异议内容', icon: 'none' })
      return
    }
    this.setData({ disputing: true })
    request.post('/errand/' + order.id + '/dispute', { reason }, true).then(() => {
      wx.showToast({ title: '异议已提交', icon: 'success' })
      this.setData({ showDisputeSheet: false, disputeContent: '' })
      this.loadOrder()
    }).catch(() => {}).finally(() => this.setData({ disputing: false }))
  },

  // 联系客服：复用页面内 contact-admin 组件（在线联系微信客服 / 添加管理员微信）
  contactService() {
    const comp = this.selectComponent('#serviceAdmin')
    if (comp) comp.openMenu()
  },

  // 「来晚啦！该订单已被其他同学接走」弹窗
  closeTakenPopup() {
    this.setData({ showTakenPopup: false })
  },

  backToHall() {
    this.setData({ showTakenPopup: false })
    wx.switchTab({ url: '/pages/errand/index' })
  },

  openCancelPublisher() {
    if (this.data.order && this.data.order.id) wx.navigateTo({ url: '/pages/errand-cancel/index?id=' + this.data.order.id + '&role=publisher' })
  },

  onContact() {
    const order = this.data.order
    if (!order) return
    // 尚未接单的浏览者：聊天/电话仅限接单人与发单人，引导先接单
    if (order.role !== 'publisher' && order.role !== 'acceptor' && order.status === 'pending') {
      wx.showToast({ title: '接单后即可与发单人沟通', icon: 'none' })
      return
    }
    // 弹出联系方式选择：在线联系 / 电话联系
    this.setData({ showContactSheet: true })
  },

  closeContactSheet() {
    this.setData({ showContactSheet: false })
  },

  // 在线联系：进入跑腿订单专属聊天（双方真实身份，与私信/匿名聊天完全独立）
  onOnlineContact() {
    this.setData({ showContactSheet: false })
    const order = this.data.order
    if (order && order.id) wx.navigateTo({ url: '/pages/errand-chat/index?orderId=' + order.id })
  },

  // 电话联系：调起系统拨号。号码取"发单方发布订单时填写的手机号"；
  // 发单人联系接单方时无发布手机号，使用接单人注册手机号
  onPhoneContact() {
    this.setData({ showContactSheet: false })
    const order = this.data.order
    if (!order) return
    const phone = order.role === 'publisher'
      ? (order.contactPhone || '')
      : (order.receiverPhone || order.contactPhone || '')
    if (!phone) {
      wx.showToast({ title: '对方暂未提供联系电话', icon: 'none' })
      return
    }
    wx.makePhoneCall({
      phoneNumber: String(phone),
      fail: () => {} // 用户取消拨号属正常操作，不提示错误
    })
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

  previewOrderImage(e) {
    const current = e.currentTarget.dataset.src
    if (!current) return
    wx.previewImage({ current, urls: this.data.order.orderImages || [] })
  },

  // 长按图片：统一二维码识别菜单（识别 / 预览），完成凭证图与取消凭证图共用
  onImageQrScan(e) {
    const { url, urls } = e.currentTarget.dataset
    qr.recognize(url, urls)
  },

  openLogs() {
    // 与 /errand/:id/logs 的「仅参与双方可见」同口径，避免第三方点了只收到 403
    if (!this.data.canViewLogs) return
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
    }).catch(() => { /* request.js 已按服务端 message 弹过提示，这里不再覆盖成笼统文案 */ })
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
