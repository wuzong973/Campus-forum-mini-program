const request = require('./request')
const loginExpiry = require('./login-expiry')

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

function saveUser(user) {
  const app = getAppSafe()
  if (!app) return
  if (user.token) {
    app.globalData.token = user.token
    wx.setStorageSync('token', user.token)
  }
  const info = {
    id: user.id,
    nickName: user.nickName || user.nick_name || '校园用户',
    avatarUrl: user.avatarUrl || user.avatar_url || '',
    gender: user.gender,
    campus: user.campus,
    phone: user.phone,
    school: user.school || '广东轻工职业技术大学',
    isVerified: user.isVerified || user.is_verified
  }
  app.globalData.userInfo = info
  wx.setStorageSync('userInfo', info)
  // 登录成功后记录活跃时间，启动 90 天时效计时
  loginExpiry.recordActiveTime()
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
  if (!isLoggedIn()) {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
    return Promise.resolve()
  }
  return request.put('/user/info', {
    nickName: fields.nickName,
    avatarUrl: fields.avatarUrl,
    gender: fields.gender,
    campus: fields.campus,
    phone: fields.phone
  }).then(() => {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
  }).catch(() => {
    saveUser({ ...getAppSafe().globalData.userInfo, ...fields })
  })
}

module.exports = { isLoggedIn, requireLogin, requirePublishReady, getMissingProfileFields, saveUser, logout, syncProfile }
