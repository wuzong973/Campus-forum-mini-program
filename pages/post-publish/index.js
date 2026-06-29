const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const imageUtil = require('../../utils/image')
const request = require('../../utils/request')
const PUBLISH_DRAFT_KEY = 'post_publish_draft'
const PENDING_POST_KEY = 'home_pending_post'

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
    mediaList: [],
    canSubmit: false,
    showTagPicker: false,
    submitting: false,
    lastSubmitPayload: null,
    submitError: ''
  },

  onLoad() {
    const app = getApp()
    if (!auth.requirePublishReady()) {
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    this.restoreDraft()
  },

  restoreDraft() {
    const draft = wx.getStorageSync(PUBLISH_DRAFT_KEY)
    if (!draft) return
    this.setData({
      title: draft.title || '',
      content: draft.content || '',
      categoryIndex: draft.categoryIndex === undefined ? -1 : draft.categoryIndex,
      mediaList: draft.mediaList || [],
      images: (draft.mediaList || []).map((item) => item.path),
      canSubmit: !!(draft.content && draft.content.trim() && draft.categoryIndex >= 0)
    })
  },

  saveDraft() {
    wx.setStorageSync(PUBLISH_DRAFT_KEY, {
      title: this.data.title,
      content: this.data.content,
      categoryIndex: this.data.categoryIndex,
      mediaList: this.data.mediaList,
      ts: Date.now()
    })
  },

  goBack() {
    wx.navigateBack()
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
    this.saveDraft()
  },

  onInput(e) {
    const content = e.detail.value
    this.setData({
      content,
      canSubmit: content.trim().length > 0 && this.data.categoryIndex >= 0
    })
    this.saveDraft()
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
    this.saveDraft()
  },

  onChooseImage() {
    imageUtil.chooseAndCompress(9 - this.data.mediaList.length).then((files) => {
      const mediaList = this.data.mediaList.concat(files)
      this.setData({
        mediaList,
        images: mediaList.map((item) => item.path)
      })
      this.saveDraft()
    }).catch(() => {})
  },

  onRemoveImage(e) {
    const mediaList = this.data.mediaList.slice()
    mediaList.splice(e.currentTarget.dataset.index, 1)
    this.setData({ mediaList, images: mediaList.map((item) => item.path) })
    this.saveDraft()
  },

  async onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) return
    if (!auth.requirePublishReady()) return
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
      let imageUrls = this.data.mediaList.filter((item) => item.type !== 'video').map((item) => item.path)
      const videoUrls = this.data.mediaList.filter((item) => item.type === 'video').map((item) => item.path)
      if (imageUrls.length && !request.USE_MOCK) {
        imageUrls = await wechat.uploadImages(imageUrls)
      }
      const payload = {
        title: this.data.title.trim(),
        category: this.data.categories[this.data.categoryIndex],
        content,
        images: imageUrls,
        videos: videoUrls
      }
      this.setData({ lastSubmitPayload: payload, submitError: '' })
      if (!request.USE_MOCK) {
        await request.post('/post', payload, true)
      } else {
        const mock = require('../../utils/mock')
        const newPost = {
          id: Date.now(),
          userId: (getApp().globalData.userInfo || {}).id || 0,
          nickName: (getApp().globalData.userInfo || {}).nickName || '我',
          avatarUrl: (getApp().globalData.userInfo || {}).avatarUrl || '',
          title: this.data.title.trim(),
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
        }
        mock.posts.unshift(newPost)
        wx.setStorageSync(PENDING_POST_KEY, newPost)
      }
      wx.removeStorageSync(PUBLISH_DRAFT_KEY)
      wx.hideLoading()
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
    } catch (e) {
      wx.hideLoading()
      this.setData({ submitError: e.message || '发布失败，请稍后重试' })
      wx.showToast({ title: e.message || '发布失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onRetrySubmit() {
    if (this.data.submitting) return
    this.onSubmit()
  }
})
