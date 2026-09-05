const request = require('../../utils/request')
const wechat = require('../../utils/wechat')
const avatar = require('../../utils/avatar')
const api = require('../../utils/api')
const { runPullDownRefresh } = require('../../utils/refresh')

const PROFILE_EXT_KEY = 'profile_ext'
const TITLE_EXT_KEY = 'profile_title_ext'

const COLOR_OPTIONS = [
  { name: '无', value: '' },
  { name: '烈焰红', value: '#e64340' },
  { name: '海洋蓝', value: '#3478f6' },
  { name: '青草绿', value: '#35bd77' },
  { name: '活力橙', value: '#ff9f40' },
  { name: '高贵紫', value: '#9b6bff' },
  { name: '樱花粉', value: '#ff6b9d' }
]

const EXCHANGE_TITLES = [
  { name: '校园新星', cost: 50 },
  { name: '风云人物', cost: 120 },
  { name: '学霸之光', cost: 200 },
  { name: '社区守护者', cost: 300 }
]

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
    myTitle: '',
    titleColor: '',
    ownedTitles: ['无'],
    colorOptions: COLOR_OPTIONS,
    exchangeTitles: EXCHANGE_TITLES,
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
    const titleExt = wx.getStorageSync(TITLE_EXT_KEY) || {}
    this.setData({
      nickName: user.nickName || '',
      avatarUrl: user.avatarUrl || avatar.getRandomAvatar(),
      signature: ext.signature || '',
      phoneMasked: maskPhone(user.phone),
      myTitle: titleExt.myTitle || '',
      titleColor: titleExt.titleColor || '',
      ownedTitles: Array.isArray(titleExt.ownedTitles) && titleExt.ownedTitles.length ? titleExt.ownedTitles : ['无']
    })
  },

  saveTitleExt(extra) {
    const ext = Object.assign({
      myTitle: this.data.myTitle,
      titleColor: this.data.titleColor,
      ownedTitles: this.data.ownedTitles
    }, extra || {})
    wx.setStorageSync(TITLE_EXT_KEY, ext)
  },

  goBack() { wx.navigateBack() },
  noop() {},
  goProfile() { wx.navigateTo({ url: '/pages/profile/index' }) },
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

  // ===== 头衔 =====
  openTitleSheet() { this.setData({ showSheet: 'title' }) },
  pickTitle(e) {
    const title = e.currentTarget.dataset.title
    this.setData({ myTitle: title === '无' ? '' : title, showSheet: '' })
    this.saveTitleExt()
    wx.showToast({ title: '头衔已更新', icon: 'none' })
  },
  openColorSheet() { this.setData({ showSheet: 'color' }) },
  pickColor(e) {
    const option = this.data.colorOptions[Number(e.currentTarget.dataset.index)]
    this.setData({ titleColor: option.value, showSheet: '' })
    this.saveTitleExt()
    wx.showToast({ title: '颜色已更新', icon: 'none' })
  },
  openExchangeSheet() { this.setData({ showSheet: 'exchange' }) },
  exchangeTitle(e) {
    const item = this.data.exchangeTitles[Number(e.currentTarget.dataset.index)]
    if (this.data.ownedTitles.indexOf(item.name) > -1) {
      wx.showToast({ title: '该头衔已拥有', icon: 'none' })
      return
    }
    wx.showModal({
      title: '兑换确认',
      content: '使用 ' + item.cost + ' 积分兑换「' + item.name + '」头衔？',
      success: (res) => {
        if (!res.confirm) return
        const ownedTitles = this.data.ownedTitles.filter((t) => t !== '无').concat(item.name)
        this.setData({ ownedTitles, myTitle: item.name })
        this.saveTitleExt()
        wx.showToast({ title: '兑换成功', icon: 'success' })
      }
    })
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
