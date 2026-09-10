const api = require('../../utils/api')

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    group: null,
    adminQrcodeUrl: '',
    gzhQrcodeUrl: '',
    images: []
  },

  onLoad(options) {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    this.groupId = Number((options && options.id) || 0)
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })
    this.loadDetail()
  },

  loadDetail() {
    if (!this.groupId) return this.failBack()
    api.getGroupChatDetail(this.groupId).then((res) => {
      const group = (res && res.group) || null
      if (!group) return this.failBack()
      this.setData({
        group,
        adminQrcodeUrl: (res && res.adminQrcodeUrl) || '',
        gzhQrcodeUrl: (res && res.gzhQrcodeUrl) || '',
        images: (res && res.images) || [],
        loading: false
      })
    }).catch(() => this.failBack())
  },

  failBack() {
    wx.showToast({ title: '群聊不存在或已下架', icon: 'none' })
    setTimeout(() => wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/group-chat/index' })
    }), 900)
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/group-chat/index' })
    })
  },

  // 点击大二维码 → 放大预览（可长按保存 / 微信扫码识别）
  onPreviewQr() {
    const url = this.data.group && this.data.group.qrcodeUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onPreviewAdmin() {
    const url = this.data.adminQrcodeUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onPreviewGzh() {
    const url = this.data.gzhQrcodeUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: this.data.images.length ? this.data.images : [url], current: url })
  }
})
