const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const imageUtil = require('../../utils/image')
const request = require('../../utils/request')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    categories: ['日常生活', '吃瓜爆料', '打听求助', '二手', '日常分享', '旧书交易'],
    categoryIndex: -1,
    tempCategoryIndex: -1,
    title: '',
    content: '',
    images: [],
    canSubmit: false,
    showTagPicker: false,
    submitting: false
  },

  onLoad() {
    const app = getApp()
    if (!auth.requireLogin('发帖需要先登录')) {
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
  },

  goBack() {
    wx.navigateBack()
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onInput(e) {
    const content = e.detail.value
    this.setData({
      content,
      canSubmit: content.trim().length > 0 && this.data.categoryIndex >= 0
    })
  },

  openTagPicker() {
    this.setData({ showTagPicker: true, tempCategoryIndex: this.data.categoryIndex })
  },

  closeTagPicker() {
    this.setData({ showTagPicker: false })
  },

  onTempTagSelect(e) {
    this.setData({ tempCategoryIndex: e.currentTarget.dataset.index })
  },

  confirmTag() {
    const categoryIndex = this.data.tempCategoryIndex
    this.setData({
      categoryIndex,
      canSubmit: this.data.content.trim().length > 0 && categoryIndex >= 0,
      showTagPicker: false
    })
  },

  onChooseImage() {
    imageUtil.chooseAndCompress(9 - this.data.images.length).then((paths) => {
      this.setData({ images: this.data.images.concat(paths) })
    }).catch(() => {})
  },

  onRemoveImage(e) {
    const images = this.data.images.slice()
    images.splice(e.currentTarget.dataset.index, 1)
    this.setData({ images })
  },

  async onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    const content = this.data.content.trim()
    if (!content) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    if (this.data.categoryIndex < 0) {
      wx.showToast({ title: '请选择标签', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中...', mask: true })

    try {
      await wechat.checkContent(content)
      let imageUrls = this.data.images
      if (imageUrls.length && !request.USE_MOCK) {
        imageUrls = await wechat.uploadImages(imageUrls)
      }
      if (!request.USE_MOCK) {
        await request.post('/post', {
          category: this.data.categories[this.data.categoryIndex],
          content: this.data.title ? this.data.title + '\n' + content : content,
          images: imageUrls
        }, true)
      } else {
        const mock = require('../../utils/mock')
        mock.posts.unshift({
          id: Date.now(),
          userId: 0,
          nickName: '我',
          avatarUrl: '',
          category: this.data.categories[this.data.categoryIndex],
          content: content,
          images: imageUrls,
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          favoriteCount: 0,
          isLiked: false,
          isFavorited: false,
          createdAt: new Date().toISOString()
        })
      }
      wx.hideLoading()
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '发布失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
