const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const request = require('../../utils/request')

const VERIFY_KEY = 'runner_verification'

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    stage: 'overview',
    campusVerified: false,
    realNameVerified: false,
    phoneBound: false,
    campusName: '',
    studentId: '',
    campusCredential: '',
    realName: '',
    identityNumber: '',
    identityCredential: '',
    campusAgreed: false,
    realAgreed: false,
    submitting: false
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    this.refreshVerification()
  },

  onShow() {
    this.refreshVerification()
  },

  refreshVerification() {
    const saved = wx.getStorageSync(VERIFY_KEY) || {}
    const status = auth.getRunnerVerification()
    this.setData({
      campusVerified: status.campusVerified,
      realNameVerified: status.realNameVerified,
      phoneBound: status.phoneBound,
      campusName: saved.campusName || this.data.campusName,
      studentId: saved.studentId || this.data.studentId,
      campusCredential: saved.campusCredential || this.data.campusCredential,
      realName: saved.realName || this.data.realName,
      identityNumber: saved.identityNumber || this.data.identityNumber,
      identityCredential: saved.identityCredential || this.data.identityCredential
    })
  },

  goBack() {
    if (this.data.stage === 'overview') {
      wx.navigateBack({ delta: 1 })
      return
    }
    this.setData({ stage: 'overview' })
  },

  enterStage(e) {
    const stage = e.currentTarget.dataset.stage
    if (stage === 'campus' && this.data.campusVerified) return
    if (stage === 'realname' && !this.data.campusVerified) {
      wx.showToast({ title: '请先完成校园认证', icon: 'none' })
      return
    }
    if (stage === 'realname' && this.data.realNameVerified) return
    this.setData({ stage })
  },

  startVerify() {
    if (!this.data.campusVerified) return this.setData({ stage: 'campus' })
    if (!this.data.realNameVerified) return this.setData({ stage: 'realname' })
    if (!this.data.phoneBound) {
      wx.showToast({ title: '请授权绑定联系手机号', icon: 'none' })
      return
    }
    wx.showToast({ title: '已具备接单资格', icon: 'success' })
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  toggleAgreement(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: !this.data[field] })
  },

  chooseCredential(e) {
    const field = e.currentTarget.dataset.field
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => this.setData({ [field]: res.tempFiles[0].tempFilePath })
    })
  },

  previewCredential(e) {
    const src = e.currentTarget.dataset.src
    if (src) wx.previewImage({ urls: [src], current: src })
  },

  saveVerification(fields) {
    const saved = wx.getStorageSync(VERIFY_KEY) || {}
    wx.setStorageSync(VERIFY_KEY, Object.assign({}, saved, fields))
  },

  submitCampus() {
    const { campusName, studentId, campusCredential, campusAgreed } = this.data
    if (!campusName.trim() || !studentId.trim()) {
      wx.showToast({ title: '请填写姓名和学号', icon: 'none' })
      return
    }
    if (!/^\d{6,12}$/.test(studentId.trim())) {
      wx.showToast({ title: '请输入 6-12 位学号', icon: 'none' })
      return
    }
    if (!campusCredential) {
      wx.showToast({ title: '请上传学生证或校园卡', icon: 'none' })
      return
    }
    if (!campusAgreed) {
      wx.showToast({ title: '请阅读并同意相关协议', icon: 'none' })
      return
    }
    this.saveVerification({ campusVerified: true, campusName: campusName.trim(), studentId: studentId.trim(), campusCredential })
    this.setData({ campusVerified: true, stage: 'realname' })
    wx.showToast({ title: '校园认证已完成', icon: 'success' })
  },

  submitRealName() {
    const { realName, identityNumber, identityCredential, realAgreed, studentId } = this.data
    if (!realName.trim() || !identityNumber.trim()) {
      wx.showToast({ title: '请填写真实姓名和身份证号', icon: 'none' })
      return
    }
    if (!/(^\d{15}$)|(^\d{17}[\dXx]$)/.test(identityNumber.trim())) {
      wx.showToast({ title: '请输入有效身份证号', icon: 'none' })
      return
    }
    if (!identityCredential) {
      wx.showToast({ title: '请上传身份证照片', icon: 'none' })
      return
    }
    if (!realAgreed) {
      wx.showToast({ title: '请阅读并同意相关协议', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    const finish = () => {
      this.saveVerification({ realNameVerified: true, realName: realName.trim(), identityNumber: identityNumber.trim(), identityCredential })
      this.setData({ realNameVerified: true, stage: 'overview', submitting: false })
      wx.showToast({ title: '实名认证已完成', icon: 'success' })
    }
    if (request.USE_MOCK) {
      finish()
      return
    }
    request.post('/user/verify', { studentId: studentId.trim(), realName: realName.trim() }, true)
      .then(finish)
      .catch((error) => {
        this.setData({ submitting: false })
        wx.showToast({ title: error.message || '认证提交失败', icon: 'none' })
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
      this.setData({ phoneBound: true })
      wx.showToast({ title: '联系手机号已绑定', icon: 'success' })
    }).catch((error) => wx.showToast({ title: error.message || '手机号绑定失败', icon: 'none' }))
  },

  contactAdmin() {
    wx.navigateTo({ url: '/pages/chat/index?peerId=1&nick=' + encodeURIComponent('校园客服') })
  },

  openAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index' })
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  }
})
