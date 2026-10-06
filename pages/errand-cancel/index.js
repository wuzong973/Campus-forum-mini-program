const request = require('../../utils/request')
const qr = require('../../utils/qr')
const auth = require('../../utils/auth')
const { runPullDownRefresh } = require('../../utils/refresh')
const errandStatus = require('../../utils/errand-status')

// 取消原因方与对应的快捷理由（与温馨提示的30分钟规则联动）
const SIDES = {
  acceptor: ['self', 'publisher'],  // 接单方取消接单：自身原因 / 发单人原因
  publisher: ['self', 'accepter']   // 发单方取消订单：自身原因 / 接单人原因
}
const SIDE_PRESETS = {
  self: ['没有时间', '距离太远', '临时有事'],
  publisher: ['联系不上需求方', '需求描述有误', '对方已自行完成'],
  accepter: ['联系不上接单方', '对方无法完成', '沟通后取消']
}
// 发单方取消订单（自身原因）时使用的快捷理由
const PUBLISHER_SELF_PRESETS = ['不想发布了', '需求信息填错了', '长时间无人接单']

Page({
  data: {
    id: '',
    role: 'acceptor', // acceptor=接单方取消接单 publisher=发布者取消订单
    statusBarHeight: 20,
    navBarHeight: 44,
    sideIndex: 0,
    sides: ['自身原因', '发单人原因'],
    presets: SIDE_PRESETS.self,
    reasonText: '',
    images: [],
    freeWindowExpired: false,
    orderAccepted: false,
    submitting: false
  },

  onLoad(options) {
    const app = getApp()
    const role = options.role === 'publisher' ? 'publisher' : 'acceptor'
    this._sideKeys = SIDES[role] || SIDES.acceptor
    this.setData({
      id: options.id || '',
      role,
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44,
      sides: role === 'publisher' ? ['自身原因', '接单人原因'] : ['自身原因', '发单人原因'],
      presets: role === 'publisher' ? PUBLISHER_SELF_PRESETS : SIDE_PRESETS.self
    })
    this.loadFreeWindow()
  },

  // 免费取消窗口 / 是否已被接单：都取自订单详情，与「温馨提示」联动
  loadFreeWindow() {
    if (!this.data.id) return
    const role = this.data.role
    request.get('/errand/' + this.data.id, {}, true, { silent: true }).then((data) => {
      const order = data && data.order
      if (!order) return
      // 发单人取消：被接单后需接单方同意（与服务端 cancel 口径一致）
      if (role === 'publisher') {
        if (order.status === 'accepted') this.setData({ orderAccepted: true })
        return
      }
      if (role !== 'acceptor' || !order.accepted_at) return
      const acceptedTs = new Date(String(order.accepted_at).replace(' ', 'T')).getTime()
      const expired = Number.isNaN(acceptedTs) || Date.now() - acceptedTs > 30 * 60 * 1000
      if (expired) this.setData({ freeWindowExpired: true })
    }).catch(() => {})
  },

  onShow() {
    // 未登录：弹窗引导去登录（取消则退回上一页）
    if (!auth.guardPage('订单取消操作需要先登录')) return
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  goBack() {
    wx.navigateBack()
  },

  // 「举报领奖」：复用页面内 contact-admin 组件的「联系管理员」弹窗
  // （在线联系微信客服 / 添加管理员微信），与「我的」页面的「联系客服」行为完全一致
  onReportReward() {
    const comp = this.selectComponent('#serviceAdmin')
    if (comp) comp.openMenu()
  },

  selectSide(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.sideIndex) return
    const sideKey = (this._sideKeys || SIDES.acceptor)[index]
    const presets = this.data.role === 'publisher' && sideKey === 'self'
      ? PUBLISHER_SELF_PRESETS
      : SIDE_PRESETS[sideKey]
    this.setData({ sideIndex: index, presets, reasonText: '' })
  },

  onReasonText(e) {
    this.setData({ reasonText: e.detail.value })
  },

  usePreset(e) {
    this.setData({ reasonText: e.currentTarget.dataset.text })
  },

  chooseImage() {
    const remain = 3 - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (r) => this.setData({ images: this.data.images.concat(r.tempFiles.map((f) => f.tempFilePath)).slice(0, 3) })
    })
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.src
    if (!current) return
    wx.previewImage({ current, urls: this.data.images })
  },

  // 长按凭证图：统一二维码识别菜单（识别 / 预览）
  onImageQrScan(e) {
    const { url, urls } = e.currentTarget.dataset
    qr.recognize(url, urls)
  },

  removeImage(e) {
    const images = this.data.images.slice()
    images.splice(Number(e.currentTarget.dataset.index), 1)
    this.setData({ images })
  },

  uploadImages() {
    if (!this.data.images.length) return Promise.resolve([])
    const token = getApp().globalData.token || wx.getStorageSync('token') || ''
    return Promise.all(this.data.images.map((filePath) => new Promise((resolve, reject) => {
      wx.uploadFile({
        url: request.BASE_URL + '/user/upload/image',
        filePath,
        name: 'file',
        header: { Authorization: 'Bearer ' + token },
        success(res) {
          try {
            const body = JSON.parse(res.data)
            if (res.statusCode === 200 && body.code === 200) resolve(body.data.url)
            else reject(new Error(body.message || '图片上传失败'))
          } catch (e) { reject(e) }
        },
        fail: reject
      })
    })))
  },

  submit() {
    if (this.data.submitting) return
    const reason = this.data.reasonText.trim()
    if (!reason) {
      wx.showToast({ title: this.data.role === 'publisher' ? '请填写取消订单理由' : '请填写取消接单理由', icon: 'none' })
      return
    }
    if (this.data.role === 'publisher') {
      // 已被接单时取消不再是「直接终止」，而是提交给接单方审批 ——
      // 弹窗文案必须如实说明，否则用户以为点完订单就没了
      const needReview = !!this.data.orderAccepted
      wx.showModal({
        title: needReview ? '提交取消申请' : '确认取消订单',
        content: needReview
          ? '订单已被接单，需接单方同意后订单才会终止并退还赏金。是否提交申请？'
          : '取消后订单将终止，赏金会按原支付路径退回。',
        cancelText: '我再想想',
        confirmText: needReview ? '提交申请' : '确认提交',
        confirmColor: needReview ? '#347ff2' : '#ee4444',
        success: (r) => {
          if (r.confirm) this.doCancelOrder(reason)
        }
      })
      return
    }
    const side = (this._sideKeys || SIDES.acceptor)[this.data.sideIndex]
    if (side === 'self') {
      wx.showModal({
        title: '提示',
        content: '若您因自身原因取消接单，将会降低完成率，完成率过低将被系统冻结接单功能。请谨慎操作。',
        cancelText: '我再想想',
        confirmText: '确认提交',
        confirmColor: '#347ff2',
        success: (r) => {
          if (r.confirm) this.doRelease(side, reason)
        }
      })
      return
    }
    this.doRelease(side, reason)
  },

  // 发布者取消整个订单：待接单时直接终止并退款；已被接单时改为提交「取消申请」给接单方审批
  doCancelOrder(reason) {
    this.setData({ submitting: true })
    this.uploadImages().then((images) => {
      const reasonSide = (this._sideKeys || ['self', 'accepter'])[this.data.sideIndex]
      return request.post('/errand/' + this.data.id + '/cancel', { reason, reasonSide, images }, true, { idempotencyKey: 'errand_cancel_' + this.data.id })
    }).then((data) => {
      if (data && data.mode === 'requested') {
        // 已被接单：仅提交申请，订单状态不变，等接单方同意
        wx.showToast({ title: '已提交，等待接单方同意', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1200)
        return
      }
      errandStatus.publish(this.data.id, 'cancelled')
      wx.showToast({ title: data && data.refundStatus ? '订单已取消，退款处理中' : '订单已取消', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 900)
    }).catch(() => {}).finally(() => this.setData({ submitting: false }))
  },

  // 接单方取消接单：30分钟内自身原因直接生效并退款，其余需发单人同意
  doRelease(side, reason) {
    this.setData({ submitting: true })
    this.uploadImages().then((images) => {
      return request.post('/errand/' + this.data.id + '/release', {
        reasonSide: side,
        reason,
        images
      }, true, { idempotencyKey: 'errand_release_' + this.data.id })
    }).then((data) => {
      if (data && data.mode === 'requested') {
        wx.showToast({ title: '已提交，等待发单人同意', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1200)
      } else if (data && data.refundStatus === 'FAILED') {
        wx.showToast({ title: '已取消接单，退款发起失败，请联系客服', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1600)
      } else {
        errandStatus.publish(this.data.id, 'cancelled')
        wx.showToast({ title: '已取消接单，赏金将原路退回', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1200)
      }
    }).catch(() => {}).finally(() => this.setData({ submitting: false }))
  }
})
