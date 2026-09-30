const request = require('../../utils/request')
const qr = require('../../utils/qr')
const auth = require('../../utils/auth')
const { runPullDownRefresh } = require('../../utils/refresh')
const errandStatus = require('../../utils/errand-status')

Page({
  data: {
    id: '',
    statusBarHeight: 20,
    navBarHeight: 44,
    description: '',
    images: [],
    submitting: false,
    // 提交成功后的提示弹窗：倒计时结束自动返回订单详情，也可点击立即返回
    showTip: false,
    countdown: 5,
    autoConfirmHours: 2
  },

  onLoad(options) {
    const app = getApp()
    this.setData({
      id: options.id || '',
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    })
  },

  onShow() {
    // 未登录：弹窗引导去登录（取消则退回上一页）
    if (!auth.guardPage('完成订单需要先登录')) return
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  goBack() {
    wx.navigateBack()
  },

  onDescription(e) {
    this.setData({ description: e.detail.value })
  },

  usePreset(e) {
    this.setData({ description: e.currentTarget.dataset.text })
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
    const description = this.data.description.trim()
    if (!description) {
      wx.showToast({ title: '请填写提交完成说明', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认提交',
      content: '提交后订单将完成，佣金经平台确认后到账。',
      cancelText: '我再想想',
      confirmText: '确认提交',
      confirmColor: '#347ff2',
      success: (r) => {
        if (r.confirm) this.doFinish(description)
      }
    })
  },

  doFinish(description) {
    this.setData({ submitting: true })
    this.uploadImages().then((images) => {
      return request.post('/errand/' + this.data.id + '/finish', { description, images }, true, { idempotencyKey: 'errand_finish_' + this.data.id })
    }).then((res) => {
      errandStatus.publish(this.data.id, 'finishing')
      // 订单已置为「待确认」：弹窗提示等待发单人确认，倒计时后自动回到订单详情
      this.setData({ autoConfirmHours: (res && res.autoConfirmHours) || 2 })
      this.showSubmittedTip()
    }).catch(() => {}).finally(() => this.setData({ submitting: false }))
  },

  // 提交成功提示：5 秒倒计时后自动返回订单详情，也可点击立即返回
  showSubmittedTip() {
    this.clearTipTimer()
    this.setData({ showTip: true, countdown: 5 })
    this._tipTimer = setInterval(() => {
      const next = this.data.countdown - 1
      if (next <= 0) {
        this.backToDetail()
        return
      }
      this.setData({ countdown: next })
    }, 1000)
  },

  // 返回订单详情：从详情页进入时直接回退（onShow 会自动刷新为「待确认」），
  // 从列表页「立即完成」进入时用 redirectTo 落回详情页
  backToDetail() {
    this.clearTipTimer()
    this.setData({ showTip: false })
    const pages = getCurrentPages()
    const prev = pages[pages.length - 2]
    if (prev && prev.route === 'pages/errand-detail/index') {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/pages/errand-detail/index?id=' + this.data.id })
  },

  clearTipTimer() {
    if (this._tipTimer) {
      clearInterval(this._tipTimer)
      this._tipTimer = null
    }
  },

  onUnload() {
    this.clearTipTimer()
  }
})
