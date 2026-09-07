const request = require('../../utils/request')
const qr = require('../../utils/qr')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    id: '',
    statusBarHeight: 20,
    navBarHeight: 44,
    description: '',
    images: [],
    submitting: false
  },

  onLoad(options) {
    const app = getApp()
    this.setData({
      id: options.id || '',
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    })
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
    }).then(() => {
      wx.showToast({ title: '提交成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    }).catch(() => {}).finally(() => this.setData({ submitting: false }))
  }
})
