const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const avatar = require('../../utils/avatar')
const { runPullDownRefresh } = require('../../utils/refresh')
const PROFILE_EXT_KEY = 'profile_ext'
const COMMON_ADDR_KEY = 'common_address'
// 微信资料同步偏好：记录用户上次同步头像/昵称时选择的来源，便于后续使用
const SYNC_PREF_KEY = 'wechat_sync_pref'

Page({
  data: {
    userInfo: null,
    genderText: '男',
    showAvatarSource: false,
    showProfileModal: false,
    editAvatar: '',
    editNickname: '',
    editGender: 1,
    editSchool: '广东轻工职业技术大学',
    campusGroups: [
      { name: '广州校区', campuses: ['新港校区', '琶洲校区'] },
      { name: '佛山校区', campuses: ['南海南校区', '南海北校区'] }
    ],
    editCampusGroup: '',
    campusOptions: [],
    editCampus: '',
    nicknameFocus: false,
    awaitingWechatNickname: false,
    commonAddress: '',
    savingProfile: false,
    syncingWechatAvatar: false,
    syncingWechatNickname: false,
    syncPref: null
  },

  onShow() {
    const defaults = avatar.getDefaultProfile()
    const userInfo = Object.assign({}, defaults, getApp().globalData.userInfo || {})
    if (!avatar.isStoredAvatar(userInfo.avatarUrl)) userInfo.avatarUrl = defaults.avatarUrl
    if (avatar.isDefaultName(userInfo.nickName)) userInfo.nickName = defaults.nickName
    const genderMap = { 0: '未知', 1: '男', 2: '女' }
    this.setData({
      userInfo: Object.assign({ school: '广东轻工职业技术大学' }, userInfo),
      genderText: genderMap[userInfo.gender] || '男',
      commonAddress: wx.getStorageSync(COMMON_ADDR_KEY) || '',
      syncPref: wx.getStorageSync(SYNC_PREF_KEY) || null
    })
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  onEditAvatar() { this.openProfileModal() },
  onEditNickname() { this.openProfileModal() },
  onEditGender() { this.openProfileModal() },
  onEditSchool() { this.openProfileModal() },
  onEditCampus() { this.openProfileModal() },

  onLoad(options) {
    if (options && options.completeProfile) {
      setTimeout(() => this.openProfileModal(), 300)
    }
  },

  openProfileModal() {
    const defaults = avatar.getDefaultProfile()
    const userInfo = Object.assign({}, defaults, getApp().globalData.userInfo || {})
    if (!avatar.isStoredAvatar(userInfo.avatarUrl)) userInfo.avatarUrl = defaults.avatarUrl
    if (avatar.isDefaultName(userInfo.nickName)) userInfo.nickName = defaults.nickName
    const campusGroup = this.getCampusGroup(userInfo.campus)
    const syncPref = wx.getStorageSync(SYNC_PREF_KEY) || null
    this.setData({
      showProfileModal: true,
      editAvatar: userInfo.avatarUrl || '',
      editNickname: userInfo.nickName || '',
      editGender: userInfo.gender !== undefined ? userInfo.gender : 1,
      editSchool: '广东轻工职业技术大学',
      editCampusGroup: campusGroup,
      campusOptions: this.getCampusOptions(campusGroup),
      editCampus: userInfo.campus || '',
      syncPref
    })
    // 偏好复用：用户上次用过微信昵称且当前昵称仍为默认值时，自动拉起微信昵称填写
    if (syncPref && syncPref.nicknameSource === 'wechat' && avatar.isDefaultName(userInfo.nickName)) {
      this.setData({ awaitingWechatNickname: true, nicknameFocus: false })
      setTimeout(() => this.setData({ nicknameFocus: true }), 260)
    }
  },

  closeProfileModal() { this.setData({ showProfileModal: false }) },
  closeAvatarSource() { this.setData({ showAvatarSource: false }) },
  // 打开头像来源弹窗前先做隐私授权预检（chooseAvatar/相册均属隐私接口）
  onModalAvatarTap() {
    if (this.data.syncingWechatAvatar) return
    wechat.ensurePrivacyAuthorize().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需同意隐私保护指引后才能同步微信头像', icon: 'none' })
        return
      }
      this.setData({ showAvatarSource: true })
    })
  },

  saveSyncPref(patch) {
    const pref = Object.assign({}, this.data.syncPref || {}, patch, { updatedAt: Date.now() })
    try {
      wx.setStorageSync(SYNC_PREF_KEY, pref)
    } catch (e) { /* 存储异常不阻断主流程 */ }
    this.setData({ syncPref: pref })
  },

  onChooseAlbumAvatar() {
    wechat.ensurePrivacyAuthorize().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需同意隐私保护指引后才能选择图片', icon: 'none' })
        return
      }
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

  onChooseWechatAvatar(e) {
    const avatarUrl = e && e.detail && e.detail.avatarUrl
    if (!avatarUrl) return this.showWechatSyncError('头像', e && e.detail)
    this.syncWechatAvatar(avatarUrl)
  },

  onUseWechatNickname() {
    if (this.data.syncingWechatNickname || !auth.requireLogin('同步微信昵称需要先登录')) return
    // 隐私授权预检：未同意《用户隐私保护指引》时先拉起官方授权弹窗
    wechat.ensurePrivacyAuthorize().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需同意隐私保护指引后才能使用微信昵称', icon: 'none' })
        return
      }
      // type="nickname" invokes WeChat's current nickname filling capability.
      // wx.getUserProfile no longer returns nicknames on current base libraries.
      this.setData({ awaitingWechatNickname: true, nicknameFocus: false })
      setTimeout(() => this.setData({ nicknameFocus: true }), 80)
    })
  },

  onNicknameInput(e) { this.setData({ editNickname: e.detail.value }) },
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
  onSelectGender(e) { this.setData({ editGender: parseInt(e.currentTarget.dataset.value, 10) }) },
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
    const currentCampus = this.data.editCampus
    const campusOptions = this.getCampusOptions(editCampusGroup)
    this.setData({
      editCampusGroup,
      campusOptions,
      editCampus: campusOptions.indexOf(currentCampus) > -1 ? currentCampus : ''
    })
  },

  onSelectSubCampus(e) { this.setData({ editCampus: e.currentTarget.dataset.value }) },

  syncWechatAvatar(tempAvatarUrl) {
    if (this.data.syncingWechatAvatar || !auth.requireLogin('同步微信头像需要先登录')) return
    this.setData({ syncingWechatAvatar: true })
    wx.showLoading({ title: '正在同步微信头像...', mask: true })
    wechat.uploadImages([tempAvatarUrl])
      .then((urls) => {
        const avatarUrl = urls[0]
        if (!avatarUrl) throw new Error('微信头像上传失败，请重试')
        return this.persistWechatProfile({ avatarUrl }, '头像')
      })
      .catch((error) => {
        wx.hideLoading()
        this.setData({ syncingWechatAvatar: false })
        this.showWechatSyncError('头像', error)
      })
  },

  persistWechatProfile(fields, fieldLabel) {
    return auth.syncProfile(fields).then((result) => {
      const oldExt = wx.getStorageSync(PROFILE_EXT_KEY) || {}
      wx.setStorageSync(PROFILE_EXT_KEY, Object.assign({}, oldExt, fields))
      // 记录同步偏好：用户选择了微信来源的头像/昵称，供后续自动拉起复用
      if (fieldLabel === '头像') this.saveSyncPref({ avatarSource: 'wechat' })
      else this.saveSyncPref({ nicknameSource: 'wechat' })
      const patch = {}
      if (fields.avatarUrl) patch.editAvatar = fields.avatarUrl
      if (fields.nickName) patch.editNickname = fields.nickName
      patch.userInfo = getApp().globalData.userInfo
      if (fieldLabel === '头像') {
        patch.showAvatarSource = false
        patch.syncingWechatAvatar = false
      } else {
        patch.awaitingWechatNickname = false
        patch.syncingWechatNickname = false
      }
      this.setData(patch)
      wx.hideLoading()
      wx.showToast({
        title: result && result.queued ? '网络异常，已保存待同步' : `微信${fieldLabel}已同步`,
        icon: result && result.queued ? 'none' : 'success'
      })
      return result
    }).catch((error) => {
      wx.hideLoading()
      if (fieldLabel === '头像') this.setData({ syncingWechatAvatar: false })
      else this.setData({ awaitingWechatNickname: false, syncingWechatNickname: false })
      this.showWechatSyncError(fieldLabel, error)
    })
  },

  showWechatSyncError(fieldLabel, error) {
    const message = String((error && (error.errMsg || error.message)) || '')
    let title = `微信${fieldLabel}同步失败，请重试`
    if (/deny|cancel|取消|拒绝/i.test(message)) title = `未授权微信${fieldLabel}，已取消同步`
    else if (/privacy|隐私|112/i.test(message)) title = '请先阅读并同意隐私保护指引'
    else if (/未登录|登录|401/i.test(message)) title = '登录已过期，请重新登录后同步'
    else if (/network|timeout|网络|超时/i.test(message)) title = '网络异常，请检查网络后重试'
    wx.showToast({ title, icon: 'none' })
  },

  onConfirmProfile() {
    if (this.data.savingProfile) return
    const { editAvatar, editNickname, editGender, editCampus } = this.data
    if (this.data.editCampusGroup && !editCampus) {
      wx.showToast({ title: '请选择具体校区', icon: 'none' })
      return
    }
    this.setData({ savingProfile: true })
    const uploadAvatar = avatar.isTemporaryAvatar(editAvatar)
      ? wechat.uploadImages([editAvatar]).then((urls) => urls[0] || editAvatar)
      : Promise.resolve(editAvatar)
    uploadAvatar.then((avatarUrl) => {
      const fields = {
        avatarUrl,
        nickName: editNickname,
        gender: editGender,
        school: '广东轻工职业技术大学',
        campus: editCampus
      }
      return auth.syncProfile(fields).then((result) => ({ result, avatarUrl }))
    }).then(({ result, avatarUrl }) => {
      const genderMap = { 0: '未知', 1: '男', 2: '女' }
      const oldExt = wx.getStorageSync(PROFILE_EXT_KEY) || {}
      wx.setStorageSync(PROFILE_EXT_KEY, Object.assign({}, oldExt, {
        nickName: editNickname,
        avatarUrl,
        campus: editCampus
      }))
      this.setData({
        userInfo: getApp().globalData.userInfo,
        genderText: genderMap[editGender] || '男',
        showProfileModal: false
      })
      wx.showToast({ title: result && result.queued ? '已保存，等待网络同步' : '资料已保存', icon: 'success' })
    }).catch((error) => {
      wx.showToast({ title: error.message || '头像保存失败，请重试', icon: 'none' })
    }).then(() => this.setData({ savingProfile: false }))
  },

  onGetPhoneNumber(e) {
    const phoneCode = e && e.detail && e.detail.code
    if (!phoneCode) {
      wx.showToast({ title: '请授权微信手机号后重试', icon: 'none' })
      return
    }
    wechat.updatePhone(phoneCode).then((data) => {
      const app = getApp()
      app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, { phone: data.phone })
      wx.setStorageSync('userInfo', app.globalData.userInfo)
      this.setData({ userInfo: app.globalData.userInfo })
      wx.showToast({ title: '手机号已更新', icon: 'success' })
    }).catch((error) => wx.showToast({ title: error.message || '手机号更新失败', icon: 'none' }))
  },

  // 常用地址输入
  onCommonAddrInput(e) {
    this.setData({ commonAddress: e.detail.value })
  },

  // 常用地址失焦保存
  onCommonAddrBlur() {
    wx.setStorageSync(COMMON_ADDR_KEY, this.data.commonAddress.trim())
  },

  // 地图选点
  onChooseCommonAddr() {
    wx.chooseLocation({
      success: (res) => {
        if (res.name || res.address) {
          const addr = res.name || res.address
          this.setData({ commonAddress: addr })
          wx.setStorageSync(COMMON_ADDR_KEY, addr)
        }
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '定位失败，请手动输入', icon: 'none' })
        }
      }
    })
  },

  onUserAgreement() { wx.navigateTo({ url: '/pages/agreement/index' }) },
  onPrivacyPolicy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  onVersionInfo() { wx.showToast({ title: '当前版本 v1.1.28', icon: 'none' }) },
  onSecurity() { wx.navigateTo({ url: '/pages/security/index' }) },
  onRules() { wx.navigateTo({ url: '/pages/rules/index' }) },

  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          auth.logout()
          wx.showToast({ title: '已退出登录', icon: 'success' })
          setTimeout(() => wx.switchTab({ url: '/pages/user/index' }), 1000)
        }
      }
    })
  }
})
