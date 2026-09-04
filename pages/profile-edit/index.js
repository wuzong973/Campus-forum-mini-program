const request = require('../../utils/request')
const wechat = require('../../utils/wechat')
const avatar = require('../../utils/avatar')
const { runPullDownRefresh } = require('../../utils/refresh')

const DRAFT_KEY = 'profile_edit_draft'
const PROFILE_EXT_KEY = 'profile_ext'

Page({
  data: {
    nickName: '',
    avatarUrl: '',
    coverUrl: '/assets/banners/banner-community.png',
    signature: '',
    socialAccount: '',
    modules: [
      { key: 'posts', label: '帖子列表', visible: true },
      { key: 'favorites', label: '收藏内容', visible: true },
      { key: 'likes', label: '获赞数据', visible: true }
    ],
    previewing: false,
    saving: false
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  onLoad() {
    const app = getApp()
    const defaults = avatar.getDefaultProfile()
    const user = Object.assign({}, defaults, app.globalData.userInfo || {})
    if (!avatar.isStoredAvatar(user.avatarUrl)) user.avatarUrl = defaults.avatarUrl
    if (avatar.isDefaultName(user.nickName)) user.nickName = defaults.nickName
    const ext = wx.getStorageSync(PROFILE_EXT_KEY) || {}
    const draft = wx.getStorageSync(DRAFT_KEY)
    const source = draft || Object.assign({}, ext, {
      nickName: user.nickName || '',
      avatarUrl: user.avatarUrl || '',
      coverUrl: ext.coverUrl || '/assets/banners/banner-community.png',
      signature: ext.signature || ''
    })
    this.setData({
      nickName: source.nickName || '',
      avatarUrl: source.avatarUrl || avatar.getRandomAvatar(),
      coverUrl: source.coverUrl || '/assets/banners/banner-community.png',
      signature: source.signature || '',
      socialAccount: source.socialAccount || '',
      modules: source.modules || this.data.modules
    })
  },

  saveDraft() {
    wx.setStorageSync(DRAFT_KEY, {
      nickName: this.data.nickName,
      avatarUrl: this.data.avatarUrl,
      coverUrl: this.data.coverUrl,
      signature: this.data.signature,
      socialAccount: this.data.socialAccount,
      modules: this.data.modules,
      ts: Date.now()
    })
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
    this.saveDraft()
  },

  chooseImage(e) {
    const field = e.currentTarget.dataset.field
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath
        this.setData({ [field]: path })
        this.saveDraft()
      }
    })
  },

  onToggleModule(e) {
    const index = Number(e.currentTarget.dataset.index)
    const modules = this.data.modules.slice()
    modules[index].visible = e.detail.value
    this.setData({ modules })
    this.saveDraft()
  },

  moveModule(e) {
    const index = Number(e.currentTarget.dataset.index)
    const dir = e.currentTarget.dataset.dir
    const target = dir === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= this.data.modules.length) return
    const modules = this.data.modules.slice()
    const temp = modules[index]
    modules[index] = modules[target]
    modules[target] = temp
    this.setData({ modules })
    this.saveDraft()
  },

  onPreview() {
    this.setData({ previewing: true })
    wx.showToast({ title: '预览已更新', icon: 'success' })
  },

  onRollback() {
    wx.removeStorageSync(DRAFT_KEY)
    wx.showToast({ title: '已回滚草稿', icon: 'success' })
    setTimeout(() => this.onLoad(), 300)
  },

  async onSave() {
    if (!this.data.nickName.trim()) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      let avatarUrl = this.data.avatarUrl
      let coverUrl = this.data.coverUrl
      if (!request.USE_MOCK) {
        if (avatar.isTemporaryAvatar(avatarUrl)) {
          avatarUrl = (await wechat.uploadImages([avatarUrl]))[0] || avatarUrl
        }
        if (avatar.isTemporaryAvatar(coverUrl)) {
          coverUrl = (await wechat.uploadImages([coverUrl]))[0] || coverUrl
        }
        await request.put('/user/info', {
          nickName: this.data.nickName.trim(),
          avatarUrl
        }, true)
      }
      const ext = {
        nickName: this.data.nickName.trim(),
        avatarUrl,
        coverUrl,
        signature: this.data.signature.trim(),
        socialAccount: this.data.socialAccount.trim(),
        modules: this.data.modules
      }
      wx.setStorageSync(PROFILE_EXT_KEY, ext)
      wx.removeStorageSync(DRAFT_KEY)
      const app = getApp()
      app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, {
        nickName: ext.nickName,
        avatarUrl: ext.avatarUrl
      })
      wx.setStorageSync('userInfo', app.globalData.userInfo)
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
