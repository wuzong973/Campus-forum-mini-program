const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const imageUtil = require('../../utils/image')
const request = require('../../utils/request')
const PUBLISH_DRAFT_KEY = 'post_publish_draft'
const PENDING_POST_KEY = 'home_pending_post'

Page({
  data: {
    categories: ['日常话题', '表白交友', '二手闲置', '失物寻物', '树洞吐槽', '组队拼车'],
    categoryIndex: -1,
    tempCategoryIndex: -1,
    title: '',
    content: '',
    images: [],
    mediaList: [],
    canSubmit: false,
    showTagPicker: false,
    showContactSheet: false,
    contactName: '',
    contactType: '手机号码',
    contactTypes: ['手机号码', '微信账号', 'QQ账号'],
    contactValue: '',
    contactSummary: '方便其他同学联系',
    secondIdentity: false,
    submitting: false,
    lastSubmitPayload: null,
    submitError: ''
  },

  onLoad() {
    if (!auth.requirePublishReady()) {
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
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
      contactName: draft.contactName || '',
      contactType: draft.contactType || '手机号码',
      contactValue: draft.contactValue || '',
      contactSummary: draft.contactName && draft.contactValue
        ? draft.contactName + ' · ' + (draft.contactType || '手机号码')
        : '方便其他同学联系',
      secondIdentity: !!draft.secondIdentity,
      canSubmit: !!(draft.content && draft.content.trim() && draft.categoryIndex >= 0)
    })
  },

  saveDraft() {
    wx.setStorageSync(PUBLISH_DRAFT_KEY, {
      title: this.data.title,
      content: this.data.content,
      categoryIndex: this.data.categoryIndex,
      mediaList: this.data.mediaList,
      contactName: this.data.contactName,
      contactType: this.data.contactType,
      contactValue: this.data.contactValue,
      secondIdentity: this.data.secondIdentity,
      ts: Date.now()
    })
  },

  goBack() {
    wx.navigateBack()
  },

  noop() {},

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

  openContactSheet() {
    this.setData({ showContactSheet: true })
  },

  closeContactSheet() {
    this.setData({ showContactSheet: false })
  },

  updateContactSummary() {
    const { contactName, contactType, contactValue } = this.data
    const contactSummary = contactName && contactValue
      ? contactName + ' · ' + contactType
      : '方便其他同学联系'
    this.setData({ contactSummary })
  },

  onContactNameInput(e) {
    this.setData({ contactName: e.detail.value }, () => { this.updateContactSummary(); this.saveDraft() })
  },

  onContactTypeSelect(e) {
    this.setData({ contactType: e.currentTarget.dataset.value }, () => { this.updateContactSummary(); this.saveDraft() })
  },

  onContactValueInput(e) {
    this.setData({ contactValue: e.detail.value }, () => { this.updateContactSummary(); this.saveDraft() })
  },

  confirmContact() {
    if (!this.data.contactName.trim() || !this.data.contactValue.trim()) {
      wx.showToast({ title: '请填写联系人和联系方式', icon: 'none' })
      return
    }
    this.updateContactSummary()
    this.setData({ showContactSheet: false })
  },

  onSecondIdentityChange(e) {
    this.setData({ secondIdentity: !!e.detail.value })
    this.saveDraft()
  },

  openRules() {
    wx.navigateTo({ url: '/pages/rules/index' })
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
        videos: videoUrls,
        contact: this.data.contactName && this.data.contactValue ? {
          name: this.data.contactName.trim(),
          type: this.data.contactType,
          value: this.data.contactValue.trim()
        } : null
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
          campus: (getApp().globalData.userInfo || {}).campus || '',
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
          contact: this.data.contactName && this.data.contactValue ? {
            name: this.data.contactName.trim(),
            type: this.data.contactType,
            value: this.data.contactValue.trim()
          } : null,
          isSecondIdentity: this.data.secondIdentity,
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
