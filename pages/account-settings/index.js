const auth = require('../../utils/auth')
const avatar = require('../../utils/avatar')
const wechat = require('../../utils/wechat')
const { runPullDownRefresh } = require('../../utils/refresh')

const PROFILE_EXT_KEY = 'profile_ext'
const SYNC_PREF_KEY = 'wechat_sync_pref'
const COMMON_ADDR_KEY = 'common_address'

Page({
  data: {
    userInfo: null,
    genderText: '未设置',
    commonAddress: '',
    showProfileModal: false,
    // 待完善字段高亮：从引导入口（requirePublishReady）带 focus 参数进来时标记
    missingMap: {},
    showAvatarSource: false,
    editAvatar: '',
    editNickname: '',
    editGender: 1,
    editCampusGroup: '',
    campusOptions: [],
    editCampus: '',
    nicknameFocus: false,
    awaitingWechatNickname: false,
    savingProfile: false,
    syncingWechatAvatar: false,
    syncingWechatNickname: false,
    syncPref: null,
    showPhoneModal: false,
    phoneInput: '',
    savingPhone: false,
    campusGroups: [
      { name: '广州校区', campuses: ['新港校区', '琶洲校区'] },
      { name: '佛山校区', campuses: ['南海南校区', '南海北校区'] }
    ]
  },

  onLoad(options) {
    // 完善信息引导：新用户/资料缺失时从发布等入口直接跳进来，
    // 自动弹出「完善个人资料」弹窗并高亮缺失的字段行
    if (options && options.profile === '1') {
      this._focusFields = String(options.focus || '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean)
    }
  },

  onShow() {
    this.refreshProfile()
    // 引导进入：资料刷新完成后自动弹窗（放在 onShow 尾部保证弹窗数据已就绪）
    if (this._focusFields && this._focusFields.length) {
      this.openProfileModal()
    }
  },
  onPullDownRefresh() { runPullDownRefresh(this, () => this.refreshProfile()) },

  refreshProfile() {
    const defaults = avatar.getDefaultProfile()
    const userInfo = Object.assign({}, defaults, getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {})
    userInfo.avatarUrl = avatar.normalizeLegacyAvatar(userInfo.avatarUrl)
    if (!avatar.isStoredAvatar(userInfo.avatarUrl)) userInfo.avatarUrl = defaults.avatarUrl
    if (avatar.isDefaultName(userInfo.nickName)) userInfo.nickName = defaults.nickName
    this.setData({
      userInfo: Object.assign({ school: '广东轻工职业技术大学' }, userInfo),
      genderText: userInfo.gender === 1 ? '男' : userInfo.gender === 2 ? '女' : '未设置',
      commonAddress: wx.getStorageSync(COMMON_ADDR_KEY) || '',
      syncPref: wx.getStorageSync(SYNC_PREF_KEY) || null
    })
  },

  openProfileModal() {
    const defaults = avatar.getDefaultProfile()
    const userInfo = Object.assign({}, defaults, getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {})
    userInfo.avatarUrl = avatar.normalizeLegacyAvatar(userInfo.avatarUrl)
    if (!avatar.isStoredAvatar(userInfo.avatarUrl)) userInfo.avatarUrl = defaults.avatarUrl
    if (avatar.isDefaultName(userInfo.nickName)) userInfo.nickName = defaults.nickName
    const editCampusGroup = this.getCampusGroup(userInfo.campus)
    const focus = this._focusFields || []
    // WXML 不支持数组 indexOf，预计算成对象映射用于行高亮
    const missingMap = {}
    focus.forEach((key) => { missingMap[key] = true })
    this.setData({
      showProfileModal: true,
      missingMap,
      editAvatar: userInfo.avatarUrl || defaults.avatarUrl,
      editNickname: userInfo.nickName || '',
      editGender: userInfo.gender === 2 ? 2 : 1,
      editCampusGroup,
      campusOptions: this.getCampusOptions(editCampusGroup),
      editCampus: userInfo.campus || '',
      syncPref: wx.getStorageSync(SYNC_PREF_KEY) || null
    })
  },

  closeProfileModal() { this.setData({ showProfileModal: false, nicknameFocus: false }) },
  closeAvatarSource() { this.setData({ showAvatarSource: false }) },
  closeActiveSheet() {
    if (this.data.showAvatarSource) {
      this.closeAvatarSource()
      return
    }
    this.closeProfileModal()
  },
  noop() {},

  getCampusGroup(campus) {
    const group = this.data.campusGroups.find((item) => item.name === campus || item.campuses.indexOf(campus) > -1)
    return group ? group.name : ''
  },

  getCampusOptions(groupName) {
    const group = this.data.campusGroups.find((item) => item.name === groupName)
    return group ? group.campuses : []
  },

  onSelectCampus(e) {
    const editCampusGroup = e.currentTarget.dataset.value
    const options = this.getCampusOptions(editCampusGroup)
    this.setData({
      editCampusGroup,
      campusOptions: options,
      editCampus: options.indexOf(this.data.editCampus) >= 0 ? this.data.editCampus : ''
    })
  },

  onSelectSubCampus(e) { this.setData({ editCampus: e.currentTarget.dataset.value }) },
  onSelectGender(e) { this.setData({ editGender: Number(e.currentTarget.dataset.value) }) },
  onNicknameInput(e) { this.setData({ editNickname: e.detail.value }) },

  onModalAvatarTap() {
    if (this.data.syncingWechatAvatar) return
    wechat.ensurePrivacyAuthorize().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需同意隐私保护指引后才能选择头像', icon: 'none' })
        return
      }
      this.setData({ showAvatarSource: true })
    })
  },

  saveSyncPref(patch) {
    const syncPref = Object.assign({}, this.data.syncPref || {}, patch, { updatedAt: Date.now() })
    wx.setStorageSync(SYNC_PREF_KEY, syncPref)
    this.setData({ syncPref })
  },

  onChooseWechatAvatar(e) {
    const avatarUrl = e && e.detail && e.detail.avatarUrl
    if (!avatarUrl) return this.showWechatSyncError('头像', e && e.detail)
    this.syncWechatAvatar(avatarUrl)
  },

  onChooseAlbumAvatar() {
    wechat.ensurePrivacyAuthorize().then((granted) => {
      if (!granted) return
      this.setData({ showAvatarSource: false })
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album'],
        sizeType: ['compressed'],
        success: (res) => {
          this.setData({ editAvatar: res.tempFiles[0].tempFilePath })
          this.saveSyncPref({ avatarSource: 'album' })
        }
      })
    })
  },

  syncWechatAvatar(tempAvatarUrl) {
    if (this.data.syncingWechatAvatar || !auth.requireLogin('同步微信头像需要先登录')) return
    this.setData({ syncingWechatAvatar: true })
    wx.showLoading({ title: '正在同步微信头像...', mask: true })
    wechat.uploadImages([tempAvatarUrl])
      .then((urls) => {
        if (!urls[0]) throw new Error('微信头像上传失败，请重试')
        return this.persistWechatProfile({ avatarUrl: urls[0] }, '头像')
      })
      .catch((error) => {
        wx.hideLoading()
        this.setData({ syncingWechatAvatar: false })
        this.showWechatSyncError('头像', error)
      })
  },

  onUseWechatNickname() {
    if (this.data.syncingWechatNickname || !auth.requireLogin('同步微信昵称需要先登录')) return
    wechat.ensurePrivacyAuthorize().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需同意隐私保护指引后才能使用微信昵称', icon: 'none' })
        return
      }
      this.setData({ awaitingWechatNickname: true, nicknameFocus: false })
      setTimeout(() => this.setData({ nicknameFocus: true }), 80)
    })
  },

  onWechatNicknameReview(e) {
    if (!this.data.awaitingWechatNickname || this.data.syncingWechatNickname) return
    if (e.detail && e.detail.pass === false) {
      this.setData({ awaitingWechatNickname: false, nicknameFocus: false })
      wx.showToast({ title: '微信昵称未通过审核，请重新选择', icon: 'none' })
      return
    }
    const nickName = String(this.data.editNickname || '').trim()
    if (!nickName) {
      this.setData({ awaitingWechatNickname: false, nicknameFocus: false })
      this.showWechatSyncError('昵称')
      return
    }
    this.setData({ awaitingWechatNickname: false, nicknameFocus: false, syncingWechatNickname: true })
    wx.showLoading({ title: '正在同步微信昵称...', mask: true })
    this.persistWechatProfile({ nickName }, '昵称')
  },

  persistWechatProfile(fields, label) {
    return auth.syncProfile(fields).then((result) => {
      const ext = Object.assign({}, wx.getStorageSync(PROFILE_EXT_KEY) || {}, fields)
      wx.setStorageSync(PROFILE_EXT_KEY, ext)
      this.saveSyncPref(label === '头像' ? { avatarSource: 'wechat' } : { nicknameSource: 'wechat' })
      this.setData({
        editAvatar: fields.avatarUrl || this.data.editAvatar,
        editNickname: fields.nickName || this.data.editNickname,
        showAvatarSource: false,
        syncingWechatAvatar: false,
        syncingWechatNickname: false,
        userInfo: getApp().globalData.userInfo
      })
      wx.hideLoading()
      wx.showToast({ title: result && result.queued ? '已保存，等待网络同步' : `微信${label}已同步`, icon: result && result.queued ? 'none' : 'success' })
    }).catch((error) => {
      wx.hideLoading()
      this.setData({ syncingWechatAvatar: false, syncingWechatNickname: false })
      this.showWechatSyncError(label, error)
    })
  },

  showWechatSyncError(label, error) {
    const message = String((error && (error.errMsg || error.message)) || '')
    let title = `微信${label}同步失败，请重试`
    if (/deny|cancel|取消|拒绝/i.test(message)) title = `未授权微信${label}，已取消同步`
    else if (/privacy|隐私|112/i.test(message)) title = '请先阅读并同意隐私保护指引'
    else if (/未登录|登录|401/i.test(message)) title = '登录已过期，请重新登录后同步'
    wx.showToast({ title, icon: 'none' })
  },

  onConfirmProfile() {
    if (this.data.savingProfile) return
    const { editAvatar, editNickname, editGender, editCampus, editCampusGroup } = this.data
    if (!editNickname.trim()) return wx.showToast({ title: '请填写昵称', icon: 'none' })
    if (editCampusGroup && !editCampus) return wx.showToast({ title: '请选择具体校区', icon: 'none' })
    this.setData({ savingProfile: true })
    const uploadAvatar = avatar.isTemporaryAvatar(editAvatar)
      ? wechat.uploadImages([editAvatar]).then((urls) => urls[0] || editAvatar)
      : Promise.resolve(editAvatar)
    uploadAvatar.then((avatarUrl) => auth.syncProfile({ avatarUrl, nickName: editNickname.trim(), gender: editGender, campus: editCampus })
      .then((result) => ({ result, avatarUrl })))
      .then(({ result, avatarUrl }) => {
        wx.setStorageSync(PROFILE_EXT_KEY, Object.assign({}, wx.getStorageSync(PROFILE_EXT_KEY) || {}, { avatarUrl, nickName: editNickname.trim(), campus: editCampus }))
        this.setData({ showProfileModal: false, savingProfile: false })
        this.refreshProfile()
        wx.showToast({ title: result && result.queued ? '已保存，等待网络同步' : '资料已保存', icon: result && result.queued ? 'none' : 'success' })
      })
      .catch((error) => {
        this.setData({ savingProfile: false })
        wx.showToast({ title: error.message || '资料保存失败，请重试', icon: 'none' })
      })
  },

  openPhoneModal() {
    this.setData({ showPhoneModal: true, phoneInput: '' })
  },

  closePhoneModal() {
    if (this.data.savingPhone) return
    this.setData({ showPhoneModal: false })
  },

  onPhoneInput(e) {
    this.setData({ phoneInput: e.detail.value })
  },

  confirmPhone() {
    const phone = String(this.data.phoneInput || '').trim()
    if (!/^1[3-9]\d{9}$/.test(phone)) return wx.showToast({ title: '请输入正确的11位手机号', icon: 'none' })
    if (this.data.savingPhone) return
    this.setData({ savingPhone: true })
    wechat.savePhone(phone).then((data) => {
      const app = getApp()
      app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, { phone: (data && data.phone) || phone })
      wx.setStorageSync('userInfo', app.globalData.userInfo)
      this.setData({ showPhoneModal: false, savingPhone: false })
      this.refreshProfile()
      wx.showToast({ title: '手机号已更新', icon: 'success' })
    }).catch((error) => {
      this.setData({ savingPhone: false })
      wx.showToast({ title: error.message || '手机号保存失败，请重试', icon: 'none' })
    })
  },

  onAddressInput(e) { this.setData({ commonAddress: e.detail.value }) },
  saveAddress() { wx.setStorageSync(COMMON_ADDR_KEY, this.data.commonAddress.trim()) },
  chooseAddress() { wx.chooseLocation({ success: (res) => { const commonAddress = res.name || res.address || ''; this.setData({ commonAddress }); wx.setStorageSync(COMMON_ADDR_KEY, commonAddress) } }) },
  goSecurity() { wx.navigateTo({ url: '/pages/security/index' }) },
  goRules() { wx.navigateTo({ url: '/pages/rules/index' }) },
  goAgreement() { wx.navigateTo({ url: '/pages/agreement/index' }) },
  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  showVersion() { wx.showToast({ title: '当前版本 v1.1.28', icon: 'none' }) },
  logout() {
    wx.showModal({ title: '提示', content: '确定要退出登录吗？', success: (res) => { if (res.confirm) { auth.logout(); wx.showToast({ title: '已退出登录', icon: 'success' }); setTimeout(() => wx.switchTab({ url: '/pages/user/index' }), 700) } } })
  }
})
