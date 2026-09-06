const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

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
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  goBack() {
    wx.navigateBack()
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

  removeImage(e) {
    const images = this.data.images.slice()
    images.splice(Number(e.currentTarget.dataset.index), 1)
    this.setData({ images })
  },

  uploadImages() {
    if (!this.data.images.length || request.USE_MOCK) return Promise.resolve([])
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
      wx.showModal({
        title: '确认取消订单',
        content: '取消后订单将终止，赏金会按原支付路径退回。',
        cancelText: '我再想想',
        confirmText: '确认提交',
        confirmColor: '#ee4444',
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

  // 发布者取消整个订单（赏金原路退回）
  doCancelOrder(reason) {
    if (request.USE_MOCK) {
      const mock = require('../../utils/mock');
      [...mock.myAcceptedOrders, ...mock.myPublishedOrders].forEach((o) => {
        if (String(o.id) === String(this.data.id)) o.status = 'cancelled'
      })
      wx.showToast({ title: '订单已取消', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
      return
    }
    this.setData({ submitting: true })
    this.uploadImages().then((images) => {
      const reasonSide = (this._sideKeys || ['self', 'accepter'])[this.data.sideIndex]
      return request.post('/errand/' + this.data.id + '/cancel', { reason, reasonSide, images }, true, { idempotencyKey: 'errand_cancel_' + this.data.id })
    }).then((data) => {
      wx.showToast({ title: data && data.refundStatus ? '订单已取消，退款处理中' : '订单已取消', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 900)
    }).catch(() => {}).finally(() => this.setData({ submitting: false }))
  },

  // 接单方取消接单：30分钟内自身原因直接生效并退款，其余需发单人同意
  doRelease(side, reason) {
    this.setData({ submitting: true })
    this.uploadImages().then((images) => {
      if (request.USE_MOCK) {
        const mock = require('../../utils/mock')
        ;[...mock.myAcceptedOrders, ...mock.myPublishedOrders].forEach((o) => {
          if (String(o.id) === String(this.data.id)) {
            o.status = 'cancelled'
            o.paymentStatus = 'REFUNDING'
          }
        })
        return { mode: 'released' }
      }
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
        wx.showToast({ title: '已取消接单，赏金将原路退回', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1200)
      }
    }).catch(() => {}).finally(() => this.setData({ submitting: false }))
  }
})
