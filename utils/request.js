const app = getApp

const BASE_URL = 'http://192.168.31.33:3000/api/v1'
const USE_MOCK = true
const REQUEST_TIMEOUT = 15000

function getAppInstance() {
  try {
    return app()
  } catch (e) {
    return { globalData: { token: '' } }
  }
}

function request(options) {
  const { url, method = 'GET', data = {}, needAuth = true, silent = false, showLoading = false, timeout = REQUEST_TIMEOUT } = options
  const inst = getAppInstance()
  const header = { 'Content-Type': 'application/json' }
  if (needAuth && inst.globalData.token) {
    header.Authorization = 'Bearer ' + inst.globalData.token
  }
  if (showLoading) {
    const title = typeof showLoading === 'string' ? showLoading : '加载中...'
    wx.showLoading({ title, mask: true })
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (showLoading) wx.hideLoading()
      reject(new Error('请求超时'))
    }, timeout)

    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header,
      timeout,
      success(res) {
        clearTimeout(timer)
        if (showLoading) wx.hideLoading()
        if (res.statusCode === 401) {
          const currentToken = inst.globalData.token || wx.getStorageSync('token') || ''
          if (USE_MOCK && String(currentToken).indexOf('mock_token_') === 0) {
            reject(new Error('未登录'))
            return
          }
          inst.globalData.token = ''
          inst.globalData.userInfo = null
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          if (!silent) {
            wx.showToast({ title: '登录已过期', icon: 'none' })
            wx.navigateTo({ url: '/pages/login/index' })
          }
          reject(new Error('未登录'))
          return
        }
        if (res.statusCode >= 500) {
          if (!silent) wx.showToast({ title: '服务器繁忙', icon: 'none' })
          reject(new Error('服务器错误'))
          return
        }
        if (res.data && res.data.code === 200) {
          resolve(res.data.data)
        } else {
          const msg = (res.data && res.data.message) || '请求失败'
          if (!silent) wx.showToast({ title: msg, icon: 'none' })
          const error = new Error(msg)
          error.statusCode = res.statusCode
          error.response = res.data
          error.data = res.data && res.data.data
          error.code = (error.data && error.data.code) || (res.data && res.data.code)
          reject(error)
        }
      },
      fail(err) {
        clearTimeout(timer)
        if (showLoading) wx.hideLoading()
        if (!silent && !USE_MOCK) {
          wx.showToast({ title: '网络异常，请检查网络', icon: 'none' })
        }
        reject(err)
      }
    })
  })
}

module.exports = {
  get: (url, data, needAuth, opts) => request({ url, method: 'GET', data, needAuth, ...opts }),
  post: (url, data, needAuth, opts) => request({ url, method: 'POST', data, needAuth, ...opts }),
  put: (url, data, needAuth, opts) => request({ url, method: 'PUT', data, needAuth, ...opts }),
  del: (url, data, needAuth, opts) => request({ url, method: 'DELETE', data, needAuth, ...opts }),
  BASE_URL,
  USE_MOCK
}
