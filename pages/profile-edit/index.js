const request = require('../../utils/request')
const wechat = require('../../utils/wechat')
const avatar = require('../../utils/avatar')
const api = require('../../utils/api')
const { runPullDownRefresh } = require('../../utils/refresh')

const PROFILE_EXT_KEY = 'profile_ext'

function maskPhone(phone) {
  const value = String(phone || '').trim()
  if (!/^1\d{10}$/.test(value)) return ''
  return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

Page({
  data: {
    statusBarHeight: 20,
    nickName: '',
    avatarUrl: '',
    phoneMasked: '',
    signature: '',
    showSheet: '',
    signatureDraft: '',
    nickDraft: '',
    // 头像自选弹层
    avatarList: [],
    pickedIndex: -1,
    currentAvatarIndex: -1,
    savingAvatar: false
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  onLoad() {
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const defaults = avatar.getDefaultProfile()
    const user = Object.assign({}, defaults, app.globalData.userInfo || {})
    if (!avatar.isStoredAvatar(user.avatarUrl)) user.avatarUrl = defaults.avatarUrl
    if (avatar.isDefaultName(user.nickName)) user.nickName = defaults.nickName
    const ext = wx.getStorageSync(PROFILE_EXT_KEY) || {}
    this.setData({
      nickName: user.nickName || '',
      avatarUrl: user.avatarUrl || avatar.getRandomAvatar(),
      signature: ext.signature || '',
      phoneMasked: maskPhone(user.phone)
    })
  },

  goBack() { wx.navigateBack() },
  noop() {},
  goProfile() {
    const app = getApp()
    const userId = Number((app.globalData.userInfo || wx.getStorageSync('userInfo') || {}).id || 0)
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/profile/index?id=' + userId })
  },
  goBlacklist() { wx.navigateTo({ url: '/pages/blacklist/index' }) },

  // ===== 昵称 =====
  openNickEdit() {
    this.setData({ showSheet: 'nick', nickDraft: this.data.nickName })
  },
  onNickInput(e) { this.setData({ nickDraft: e.detail.value }) },
  async saveNick() {
    const nick = this.data.nickDraft.trim()
    if (!nick) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return }
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      if (!request.USE_MOCK) await request.put('/user/info', { nickName: nick }, true)
      this._applyProfile({ nickName: nick })
      this.setData({ showSheet: '', nickName: nick })
      wx.hideLoading()
      wx.showToast({ title: '昵称已更新', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  },

  // ===== 个人简介 =====
  openSignatureEdit() {
    this.setData({ showSheet: 'signature', signatureDraft: this.data.signature })
  },
  onSignatureInput(e) { this.setData({ signatureDraft: e.detail.value }) },
  saveSignature() {
    const value = this.data.signatureDraft.trim().slice(0, 80)
    const ext = wx.getStorageSync(PROFILE_EXT_KEY) || {}
    ext.signature = value
    wx.setStorageSync(PROFILE_EXT_KEY, ext)
    this.setData({ signature: value, showSheet: '' })
    wx.showToast({ title: '简介已保存', icon: 'success' })
  },

  // ===== 上传自定义头像（头像右下角铅笔角标） =====
  onUploadAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        const path = res.tempFiles[0].tempFilePath
        wx.showLoading({ title: '上传中...', mask: true })
        try {
          let avatarUrl = path
          if (!request.USE_MOCK) avatarUrl = (await wechat.uploadImages([path]))[0] || path
          if (!request.USE_MOCK) await request.put('/user/info', { avatarUrl }, true)
          this._applyProfile({ avatarUrl })
          this.setData({ avatarUrl })
          wx.hideLoading()
          wx.showToast({ title: '头像已更新', icon: 'success' })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: e.message || '上传失败', icon: 'none' })
        }
      }
    })
  },

  // ===== 更换默认头像：自选模式（弹层网格） =====
  onChangeDefaultAvatar() {
    // 路径规则与 getRandomAvatar 保持一致：/assets/avatar2/ + encodeURIComponent(文件名)
    const list = avatar.DEFAULT_AVATARS.map((name) => '/assets/avatar2/' + encodeURIComponent(name))
    const current = this.data.avatarUrl
    const currentAvatarIndex = list.indexOf(current)
    this.setData({
      showSheet: 'avatar',
      avatarList: list,
      currentAvatarIndex,
      pickedIndex: currentAvatarIndex > -1 ? currentAvatarIndex : -1
    })
  },

  pickAvatar(e) {
    this.setData({ pickedIndex: Number(e.currentTarget.dataset.index) })
  },

  async confirmAvatar() {
    const index = this.data.pickedIndex
    if (index < 0 || this.data.savingAvatar) return
    const avatarUrl = this.data.avatarList[index]
    this.setData({ savingAvatar: true })
    wx.showLoading({ title: '更换中...', mask: true })
    try {
      if (!request.USE_MOCK) await request.put('/user/info', { avatarUrl }, true)
      this._applyProfile({ avatarUrl })
      this.setData({ avatarUrl, showSheet: '', savingAvatar: false })
      wx.hideLoading()
      wx.showToast({ title: '已更换头像', icon: 'success' })
    } catch (e) {
      this.setData({ savingAvatar: false })
      wx.hideLoading()
      wx.showToast({ title: e.message || '更换失败', icon: 'none' })
    }
  },

  // ===== 账号安全：微信手机号授权绑定 =====
  async onGetPhoneNumber(e) {
    const detail = e.detail || {}
    if (!detail.code || (detail.errMsg && detail.errMsg.indexOf('deny') > -1)) {
      if (detail.errMsg && detail.errMsg.indexOf('deny') === -1) wx.showToast({ title: '未获取到手机号', icon: 'none' })
      return
    }
    wx.showLoading({ title: '绑定中...', mask: true })
    try {
      const result = await api.bindPhone(detail.code)
      const phone = (result && result.phone) || ''
      this.setData({ phoneMasked: maskPhone(phone) })
      this._applyProfile({ phone })
      wx.hideLoading()
      wx.showToast({ title: '绑定成功', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '绑定失败', icon: 'none' })
    }
  },

  closeSheet() { this.setData({ showSheet: '' }) },

  _applyProfile(patch) {
    const app = getApp()
    app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, patch)
    wx.setStorageSync('userInfo', app.globalData.userInfo)
  }
})
