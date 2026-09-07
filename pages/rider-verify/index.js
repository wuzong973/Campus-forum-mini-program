const auth = require('../../utils/auth')
const wechat = require('../../utils/wechat')
const request = require('../../utils/request')
const qr = require('../../utils/qr')
const { runPullDownRefresh } = require('../../utils/refresh')

const VERIFY_KEY = 'runner_verification'

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    stage: 'overview',
    campusVerified: false,
    phoneBound: false,
    studentId: '',
    jwPassword: '',
    verifyMethod: 'jw',
    campusCredential: '',
    campusAgreed: false,
    submitting: false,
    verificationStatus: 'none',
    reviewNote: '',
    showPhoneModal: false,
    phoneInput: '',
    savingPhone: false,
    overviewSteps: [],
    formSteps: []
  },

  // 步骤条：① 校园认证 → ② 认证审核 → ③ 完成认证 → ④ 成为骑手
  // none/rejected=第①步进行中；pending=①已完成②进行中；approved=①②③已完成④进行中
  buildSteps(status) {
    const labels = ['① 校园认证', '② 认证审核', '③ 完成认证', '④ 成为骑手']
    const activeIndex = status === 'pending' ? 1 : (status === 'approved' ? 3 : 0)
    return labels.map((label, index) => ({
      label,
      cls: index < activeIndex ? 'done' : (index === activeIndex ? 'active' : '')
    }))
  },

  updateSteps() {
    this.setData({
      overviewSteps: this.buildSteps(this.data.verificationStatus),
      formSteps: this.buildSteps('none')
    })
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    })
    this.refreshVerification()
    this.loadServerVerification()
  },

  onShow() {
    this.refreshVerification()
    this.loadServerVerification()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadServerVerification())
  },

  loadServerVerification() {
    request.get('/user/rider-verification', {}, true).then((data) => {
      if (!data || !data.status || data.status === 'none') return
      const saved = wx.getStorageSync(VERIFY_KEY) || {}
      const campusVerified = ['pending', 'approved'].indexOf(data.status) >= 0
      wx.setStorageSync(VERIFY_KEY, Object.assign({}, saved, {
        campusVerified,
        verificationStatus: data.status,
        reviewNote: data.reviewNote || '',
        studentId: data.studentId || saved.studentId || '',
        campusCredential: data.campusCredential || saved.campusCredential || ''
      }))
      this.setData({
        campusVerified,
        verificationStatus: data.status,
        reviewNote: data.reviewNote || '',
        studentId: data.studentId || this.data.studentId,
        campusCredential: data.campusCredential || this.data.campusCredential
      })
      this.updateSteps()
    }).catch(() => {})
  },

  refreshVerification() {
    const saved = wx.getStorageSync(VERIFY_KEY) || {}
    const status = auth.getRunnerVerification()
    this.setData({
      campusVerified: status.campusVerified,
      phoneBound: status.phoneBound,
      verificationStatus: saved.verificationStatus || status.verificationStatus || 'none',
      reviewNote: saved.reviewNote || status.reviewNote || '',
      studentId: saved.studentId || this.data.studentId,
      campusCredential: saved.campusCredential || this.data.campusCredential
    })
    this.updateSteps()
  },

  goBack() {
    if (this.data.stage === 'overview') {
      wx.navigateBack({ delta: 1 })
      return
    }
    this.setData({ stage: 'overview' })
  },

  startVerify() {
    if (this.data.verificationStatus === 'approved') {
      wx.showToast({ title: '已具备接单资格', icon: 'success' })
      return
    }
    if (this.data.verificationStatus === 'pending') {
      wx.showToast({ title: '认证审核中，请耐心等待', icon: 'none' })
      return
    }
    this.setData({ stage: 'campus' })
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  switchVerifyMethod(e) {
    const method = e.currentTarget.dataset.method
    if (['jw', 'credential'].indexOf(method) < 0) return
    this.setData({ verifyMethod: method })
  },

  toggleAgreement() {
    this.setData({ campusAgreed: !this.data.campusAgreed })
  },

  chooseCredential() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => this.setData({ campusCredential: res.tempFiles[0].tempFilePath })
    })
  },

  previewCredential(e) {
    const src = e.currentTarget.dataset.src
    if (src) wx.previewImage({ urls: [src], current: src })
  },

  // 长按凭证图：统一二维码识别菜单（识别 / 预览）
  onImageQrScan(e) {
    const src = e.currentTarget.dataset.src
    qr.recognize(src, src ? [src] : [])
  },

  saveVerification(fields) {
    const saved = wx.getStorageSync(VERIFY_KEY) || {}
    wx.setStorageSync(VERIFY_KEY, Object.assign({}, saved, fields))
  },

  checkCommonPreflight() {
    const { phoneBound, campusAgreed } = this.data
    if (!phoneBound) {
      wx.showToast({ title: '请先绑定联系手机号', icon: 'none' })
      return false
    }
    if (!campusAgreed) {
      wx.showToast({ title: '请阅读并同意相关协议', icon: 'none' })
      return false
    }
    return true
  },

  checkStudentId() {
    const studentId = String(this.data.studentId || '').trim()
    if (!studentId) {
      wx.showToast({ title: '请输入学号', icon: 'none' })
      return ''
    }
    // 学号位数不限制，填多少位都可以
    return studentId
  },

  // 认证方式一：教务系统验证（学号+密码），登录成功即通过认证
  submitJw() {
    const { jwPassword } = this.data
    const studentId = this.checkStudentId()
    if (!studentId) return
    if (!jwPassword) {
      wx.showToast({ title: '请输入教务系统密码', icon: 'none' })
      return
    }
    if (!this.checkCommonPreflight()) return

    this.setData({ submitting: true })

    const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {}
    request.post('/user/rider-verification/jw', {
      studentId,
      password: jwPassword,
      phone: userInfo.phone || ''
    }, true)
      .then((data) => this.finishJwApprove(data, studentId))
      .catch((error) => {
        this.setData({ submitting: false })
        wx.showToast({ title: (error && error.message) || '教务系统验证失败', icon: 'none' })
      })
      .then(() => this.setData({ jwPassword: '' }))
  },

  finishJwApprove(data, studentId) {
    this.saveVerification({
      campusVerified: true,
      studentId,
      verificationStatus: 'approved',
      reviewNote: ''
    })
    this.setData({
      campusVerified: true,
      stage: 'overview',
      submitting: false,
      verificationStatus: 'approved',
      reviewNote: ''
    })
    this.updateSteps()
    wx.showToast({ title: (data && data.message) || '验证通过，你已成为骑手', icon: 'success' })
  },

  // 认证方式二：上传证件人工审核
  submitCampus() {
    const { studentId, campusCredential } = this.data
    const trimmedStudentId = String(studentId || '').trim()
    if (!trimmedStudentId) {
      wx.showToast({ title: '请输入学号', icon: 'none' })
      return
    }
    // 学号位数不限制，填多少位都可以
    if (!campusCredential) {
      wx.showToast({ title: '请上传学生证或校园卡', icon: 'none' })
      return
    }
    if (!this.checkCommonPreflight()) return

    this.setData({ submitting: true })
    const submit = (credential) => {
      const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {}
      return request.post('/user/rider-verification', {
        studentId: trimmedStudentId,
        campusCredential: credential,
        phone: userInfo.phone || '',
        campusName: userInfo.campus || ''
      }, true)
    }
    const finish = (data, credential) => {
      this.saveVerification({
        campusVerified: true,
        studentId: trimmedStudentId,
        campusCredential: credential,
        verificationStatus: 'pending',
        reviewNote: ''
      })
      this.setData({
        campusVerified: true,
        campusCredential: credential,
        stage: 'overview',
        submitting: false,
        verificationStatus: 'pending',
        reviewNote: ''
      })
      this.updateSteps()
      wx.showToast({ title: (data && data.message) || '认证信息已提交，等待审核', icon: 'success' })
    }

    wechat.uploadImages([campusCredential])
      .then((urls) => {
        const credential = urls[0]
        if (!credential) throw new Error('证件上传失败，请重试')
        return submit(credential).then((data) => finish(data, credential))
      })
      .catch((error) => {
        this.setData({ submitting: false })
        wx.showToast({ title: error.message || '认证提交失败', icon: 'none' })
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
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的11位手机号', icon: 'none' })
      return
    }
    if (this.data.savingPhone) return
    this.setData({ savingPhone: true })
    wechat.savePhone(phone).then((data) => {
      const app = getApp()
      app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, { phone: (data && data.phone) || phone })
      wx.setStorageSync('userInfo', app.globalData.userInfo)
      this.setData({ phoneBound: true, showPhoneModal: false, savingPhone: false })
      wx.showToast({ title: '联系手机号已更新', icon: 'success' })
    }).catch((error) => {
      this.setData({ savingPhone: false })
      wx.showToast({ title: error.message || '手机号保存失败', icon: 'none' })
    })
  },

  openAgreement() { wx.navigateTo({ url: '/pages/agreement/index' }) },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }) }
})
