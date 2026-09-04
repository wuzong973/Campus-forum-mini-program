const request = require('./request')
const loginExpiry = require('./login-expiry')
const syncQueue = require('./syncQueue')
const avatar = require('./avatar')

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function isLoggedIn() {
  const app = getAppSafe()
  return !!(app && app.globalData.token)
}

function requireLogin(message) {
  if (isLoggedIn()) return true
  wx.showModal({
    title: '提示',
    content: message || '请先登录后再操作',
    confirmText: '去登录',
    cancelText: '取消',
    success(res) {
      if (res.confirm) wx.navigateTo({ url: '/pages/login/index' })
    }
  })
  return false
}

function getMissingProfileFields() {
  const app = getAppSafe()
  const user = (app && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {}
  const required = [
    { key: 'avatarUrl', label: '头像' },
    { key: 'nickName', label: '昵称' },
    { key: 'campus', label: '校区' },
    { key: 'gender', label: '性别' },
    { key: 'phone', label: '手机号' }
  ]
  return required.filter((item) => {
    const value = user[item.key]
    if (item.key === 'gender') return value === undefined || value === null || value === 0 || value === ''
    return !value
  })
}

function requirePublishReady() {
  if (!requireLogin('发帖需要先登录')) return false
  const missing = getMissingProfileFields()
  if (!missing.length) return true
  wx.showModal({
    title: '请完善个人信息',
    content: '发帖前需先补充：' + missing.map((item) => item.label).join('、'),
    confirmText: '去编辑',
    success(res) {
      if (res.confirm) wx.navigateTo({ url: '/pages/settings/index?completeProfile=1' })
    }
  })
  return false
}

function getRunnerVerification() {
  const verification = wx.getStorageSync('runner_verification') || {}
  const app = getAppSafe()
  const user = (app && app.globalData.userInfo) || wx.getStorageSync('userInfo') || {}
  return {
    campusVerified: !!verification.campusVerified,
    realNameVerified: !!verification.realNameVerified,
    phoneBound: !!user.phone,
    verificationStatus: verification.verificationStatus || 'none',
    reviewNote: verification.reviewNote || ''
  }
}

function requireRunnerReady() {
  if (!requireLogin('接单需要先登录')) return false
  const status = getRunnerVerification()
  if (status.campusVerified && status.realNameVerified && status.phoneBound) return true
  wx.showModal({
    title: '接单提示',
    content: '认证以后马上就能接单赚钱 💰 前往认证>>>',
    cancelText: '取消',
    confirmText: '前往',
    success(res) {
      if (res.confirm) wx.navigateTo({ url: '/pages/rider-verify/index' })
    }
  })
  return false
}

function saveUser(user) {
  const app = getAppSafe()
  if (!app) return
  if (user.token) {
    app.globalData.token = user.token
    wx.setStorageSync('token', user.token)
  }
  const current = app.globalData.userInfo || wx.getStorageSync('userInfo') || {}
  const sameUser = user && user.id && String(current.id) === String(user.id)
  const defaultProfile = avatar.getDefaultProfile()
  const currentAvatar = sameUser && avatar.isStoredAvatar(current.avatarUrl) ? current.avatarUrl : ''
  const serverAvatar = avatar.isStoredAvatar(user.avatarUrl || user.avatar_url)
    ? (user.avatarUrl || user.avatar_url)
    : ''
  const avatarUrl = serverAvatar || currentAvatar || defaultProfile.avatarUrl
  const serverNickName = user.nickName || user.nick_name || ''
  const nickName = !avatar.isDefaultName(serverNickName)
    ? serverNickName
    : (sameUser && !avatar.isDefaultName(current.nickName)
      ? current.nickName
      : defaultProfile.nickName)
  const info = {
    id: user.id,
    nickName,
    avatarUrl,
    studentId: user.studentId || user.student_id || '',
    gender: user.gender,
    campus: user.campus,
    phone: user.phone,
    school: user.school || '广东轻工职业技术大学',
    isVerified: user.isVerified || user.is_verified,
    role: user.role || 'user'
  }
  app.globalData.userInfo = info
  wx.setStorageSync('userInfo', info)
  // 登录成功后记录活跃时间，启动 90 天时效计时
  loginExpiry.recordActiveTime()
  return info
}

function logout() {
  const app = getAppSafe()
  if (app) {
    app.globalData.token = ''
    app.globalData.userInfo = null
  }
  wx.removeStorageSync('token')
  wx.removeStorageSync('userInfo')
}

function syncProfile(fields) {
  if (request.USE_MOCK) {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return Promise.resolve({ queued: false })
  }
  if (!isLoggedIn()) {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return Promise.resolve()
  }
  const payload = {
    nickName: fields.nickName,
    avatarUrl: fields.avatarUrl,
    gender: fields.gender,
    campus: fields.campus
  }
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key])
  return request.put('/user/info', payload, true, { retryable: true, idempotencyKey: `profile_${Date.now()}` }).then(() => {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return { queued: false }
  }).catch((error) => {
    if (!error.isNetwork) throw error
    syncQueue.queueProfile(payload)
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return { queued: true }
  })
}

module.exports = { isLoggedIn, requireLogin, requirePublishReady, requireRunnerReady, getRunnerVerification, getMissingProfileFields, saveUser, logout, syncProfile }
