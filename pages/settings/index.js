const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const PROFILE_EXT_KEY = 'profile_ext'

const COMMON_ADDR_KEY = 'common_address'

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
    commonAddress: ''
  },

  onShow() {
    const userInfo = getApp().globalData.userInfo || {}
    const genderMap = { 0: '未知', 1: '男', 2: '女' }
    this.setData({
      userInfo: Object.assign({ school: '广东轻工职业技术大学' }, userInfo),
      genderText: genderMap[userInfo.gender] || '男',
      commonAddress: wx.getStorageSync(COMMON_ADDR_KEY) || ''
    })
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
    const userInfo = getApp().globalData.userInfo || {}
    const campusGroup = this.getCampusGroup(userInfo.campus)
    this.setData({
      showProfileModal: true,
      editAvatar: userInfo.avatarUrl || '',
      editNickname: userInfo.nickName || '',
      editGender: userInfo.gender !== undefined ? userInfo.gender : 1,
      editSchool: '广东轻工职业技术大学',
      editCampusGroup: campusGroup,
      campusOptions: this.getCampusOptions(campusGroup),
      editCampus: userInfo.campus || ''
    })
  },

  closeProfileModal() { this.setData({ showProfileModal: false }) },
  closeAvatarSource() { this.setData({ showAvatarSource: false }) },
  onModalAvatarTap() { this.setData({ showAvatarSource: true }) },

  onChooseAlbumAvatar() {
    this.setData({ showAvatarSource: false })
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        this.setData({ editAvatar: res.tempFiles[0].tempFilePath })
      }
    })
  },

  onChooseWechatAvatar(e) {
    const avatarUrl = e && e.detail && e.detail.avatarUrl
    this.setData({ showAvatarSource: false })
    if (avatarUrl) {
      this.setData({ editAvatar: avatarUrl })
      return
    }
    if (wx.getUserProfile) {
      wx.getUserProfile({
        desc: '用于同步微信头像到个人资料',
        success: (res) => {
          this.setData({ editAvatar: (res.userInfo || {}).avatarUrl || this.data.editAvatar })
        },
        fail: () => wx.showToast({ title: '未获取到微信头像', icon: 'none' })
      })
    } else {
      wx.showToast({ title: '当前微信版本不支持', icon: 'none' })
    }
  },

  isUsableWechatNickname(nickName) {
    const value = (nickName || '').trim()
    return !!value && value !== '微信用户' && value !== '用户' && value !== '校园用户'
  },

  promptNicknamePicker() {
    this.setData({ nicknameFocus: false })
    setTimeout(() => {
      this.setData({ nicknameFocus: true })
      wx.showToast({ title: '请在输入框中选择微信昵称', icon: 'none' })
    }, 80)
  },

  onUseWechatNickname() {
    if (!wx.getUserProfile) {
      this.promptNicknamePicker()
      return
    }
    wx.getUserProfile({
      desc: '用于同步微信昵称到个人资料',
      success: (res) => {
        const nickName = (res.userInfo || {}).nickName
        if (this.isUsableWechatNickname(nickName)) {
          this.setData({ editNickname: nickName, nicknameFocus: false })
          wx.showToast({ title: '微信昵称已填入', icon: 'success' })
        } else {
          this.promptNicknamePicker()
        }
      },
      fail: () => this.promptNicknamePicker()
    })
  },

  onNicknameInput(e) { this.setData({ editNickname: e.detail.value, nicknameFocus: false }) },
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

  onConfirmProfile() {
    const { editAvatar, editNickname, editGender, editCampus } = this.data
    if (this.data.editCampusGroup && !editCampus) {
      wx.showToast({ title: '请选择具体校区', icon: 'none' })
      return
    }
    const fields = {
      avatarUrl: editAvatar,
      nickName: editNickname,
      gender: editGender,
      school: '广东轻工职业技术大学',
      campus: editCampus
    }
    auth.syncProfile(fields).then((result) => {
      const genderMap = { 0: '未知', 1: '男', 2: '女' }
      const oldExt = wx.getStorageSync(PROFILE_EXT_KEY) || {}
      wx.setStorageSync(PROFILE_EXT_KEY, Object.assign({}, oldExt, {
        nickName: editNickname,
        avatarUrl: editAvatar,
        campus: editCampus
      }))
      this.setData({
        userInfo: getApp().globalData.userInfo,
        genderText: genderMap[editGender] || '男',
        showProfileModal: false
      })
      wx.showToast({ title: result && result.queued ? '已保存，等待网络同步' : '资料已保存', icon: 'success' })
    })
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
