const auth = require('../../utils/auth')

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
    editCampus: ''
  },

  onShow() {
    const userInfo = getApp().globalData.userInfo || {}
    const genderMap = { 0: '未知', 1: '男', 2: '女' }
    this.setData({
      userInfo: Object.assign({ school: '广东轻工职业技术大学' }, userInfo),
      genderText: genderMap[userInfo.gender] || '男'
    })
  },

  onEditAvatar() { this.openProfileModal() },
  onEditNickname() { this.openProfileModal() },
  onEditGender() { this.openProfileModal() },
  onEditSchool() { this.openProfileModal() },
  onEditCampus() { this.openProfileModal() },

  openProfileModal() {
    const userInfo = getApp().globalData.userInfo || {}
    this.setData({
      showProfileModal: true,
      editAvatar: userInfo.avatarUrl || '',
      editNickname: userInfo.nickName || '',
      editGender: userInfo.gender !== undefined ? userInfo.gender : 1,
      editSchool: '广东轻工职业技术大学',
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

  onNicknameInput(e) { this.setData({ editNickname: e.detail.value }) },
  onSelectGender(e) { this.setData({ editGender: parseInt(e.currentTarget.dataset.value, 10) }) },
  onSelectCampus(e) { this.setData({ editCampus: e.currentTarget.dataset.value }) },

  onConfirmProfile() {
    const { editAvatar, editNickname, editGender, editCampus } = this.data
    const fields = {
      avatarUrl: editAvatar,
      nickName: editNickname,
      gender: editGender,
      school: '广东轻工职业技术大学',
      campus: editCampus
    }
    auth.syncProfile(fields).then(() => {
      const genderMap = { 0: '未知', 1: '男', 2: '女' }
      this.setData({
        userInfo: getApp().globalData.userInfo,
        genderText: genderMap[editGender] || '男',
        showProfileModal: false
      })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    })
  },

  onEditPhone() {
    wx.showModal({
      title: '修改手机号码',
      editable: true,
      placeholderText: '请输入手机号码',
      success: (res) => {
        if (res.confirm && res.content) {
          if (!/^1\d{10}$/.test(res.content)) {
            wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
            return
          }
          auth.syncProfile({ phone: res.content }).then(() => {
            this.setData({ userInfo: getApp().globalData.userInfo })
            wx.showToast({ title: '手机号已更新', icon: 'success' })
          })
        }
      }
    })
  },

  onUserAgreement() { wx.navigateTo({ url: '/pages/agreement/index' }) },
  onPrivacyPolicy() { wx.navigateTo({ url: '/pages/privacy/index' }) },
  onVersionInfo() { wx.showToast({ title: '当前版本 v1.1.28', icon: 'none' }) },

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
