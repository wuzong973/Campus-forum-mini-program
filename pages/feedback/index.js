Page({
  data: {
    feedbackType: '',
    feedbackContent: '',
    contact: '',
    images: [],
    canSubmit: false,
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
    if (!this.data.canSubmit) return
    wx.showToast({ title: '反馈已提交', icon: 'success' })
    setTimeout(() => {
      wx.navigateBack()
    }, 1000)
  }
})
