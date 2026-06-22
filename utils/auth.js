const request = require('./request')

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

module.exports = { isLoggedIn, requireLogin, saveUser, logout, syncProfile }
