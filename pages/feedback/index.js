const auth = require('../../utils/auth')
const request = require('../../utils/request')
const wechat = require('../../utils/wechat')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    feedbackType: '',
    feedbackContent: '',
    contact: '',
    images: [],
    canSubmit: false,
    submitting: false,
    typeList: ['功能建议', 'Bug反馈', '体验优化', '其他问题']
  },

  onSelectType() {
    wx.showActionSheet({
      itemList: this.data.typeList,
      success: (res) => {
        this.setData({
          feedbackType: this.data.typeList[res.tapIndex]
        })
        this.checkCanSubmit()
      }
    })
  },

  onContentInput(e) {
    this.setData({ feedbackContent: e.detail.value })
    this.checkCanSubmit()
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  onChooseImage() {
    const remain = 4 - this.data.images.length
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newImages = res.tempFiles.map(f => f.tempFilePath)
        this.setData({
          images: [...this.data.images, ...newImages]
        })
      }
    })
  },

  onRemoveImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images.filter((_, i) => i !== index)
    this.setData({ images })
  },

  checkCanSubmit() {
    const can = this.data.feedbackType && this.data.feedbackContent.length >= 10
    this.setData({ canSubmit: can })
  },

  onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    if (!auth.requireLogin('提交反馈前请先登录')) return
    if (request.USE_MOCK) {
      wx.showToast({ title: '演示模式暂不支持提交反馈', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wechat.uploadImages(this.data.images)
      .then((images) => request.post('/feedback', {
        type: this.data.feedbackType,
        content: this.data.feedbackContent.trim(),
        contact: this.data.contact.trim(),
        images
      }, true, { showLoading: '提交中...' }))
      .then(() => {
        wx.showToast({ title: '反馈已提交', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 900)
      })
      .catch((error) => wx.showToast({ title: error.message || '提交失败，请稍后重试', icon: 'none' }))
      .finally(() => this.setData({ submitting: false }))
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  }
})
