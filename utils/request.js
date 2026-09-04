const app = getApp

const BASE_URL = 'https://payun01.cn/api/v1'

// Every build reads from the deployed service. Test fixtures are never shown
// to users, including in the developer tools environment.
const USE_MOCK = false
const REQUEST_TIMEOUT = 15000
const READ_RETRY_COUNT = 2

function getAppInstance() {
  try { return app() } catch (e) { return { globalData: { token: '' } } }
}

function createRequestId() {
  return `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeQuery(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  return Object.keys(data).reduce((result, key) => {
    const value = data[key]
    // wx.request serializes an undefined value as the literal string
    // "undefined", which makes optional filters look like real input.
    if (value !== undefined && value !== null && value !== '') result[key] = value
    return result
  }, {})
}

function shouldRetry(error, attempt, options) {
  if (attempt >= (options.retries === undefined ? READ_RETRY_COUNT : options.retries)) return false
  if (options.method !== 'GET' && !options.retryable) return false
  return !!(error.isNetwork || error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504)
}

function execute(options, requestId) {
  const { url, method, data, needAuth, silent, timeout } = options
  const requestData = method === 'GET' ? sanitizeQuery(data) : data
  const inst = getAppInstance()
  const hadToken = !!inst.globalData.token
  const header = { 'Content-Type': 'application/json', 'X-Request-Id': requestId }
  if (needAuth && hadToken) header.Authorization = 'Bearer ' + inst.globalData.token
  if (options.idempotencyKey) header['X-Idempotency-Key'] = options.idempotencyKey

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data: requestData,
      header,
      timeout,
      success(res) {
        const response = res.data || {}
        if (res.statusCode === 401) {
          inst.globalData.token = ''
          inst.globalData.userInfo = null
          wx.removeStorageSync('token')
          wx.removeStorageSync('userInfo')
          // Page initialization can request optional personal data. A 401 must
          // not force users away from a public page; restricted actions call
          // auth.requireLogin() at the point where the user initiates them.
          if (!silent && hadToken) {
            wx.showToast({ title: '登录已过期', icon: 'none' })
          }
          const error = new Error('未登录')
          error.statusCode = 401
          error.requiresLogin = true
          error.data = response.data
          reject(error)
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && response.code === 200) {
          resolve(response.data)
          return
        }
        const error = new Error(response.message || '请求失败')
        error.statusCode = res.statusCode
        error.code = response.code
        error.requestId = response.requestId || (res.header || {})['X-Request-Id'] || requestId
        error.response = response
        // 业务错误响应体（如验证码挑战数据），供调用方读取 err.data.code 等字段
        error.data = response.data
        if (!silent) wx.showToast({ title: error.message, icon: 'none' })
        reject(error)
      },
      fail(err) {
        const error = new Error(err.errMsg || '网络异常，请检查网络')
        error.isNetwork = true
        error.requestId = requestId
        if (!silent) wx.showToast({ title: '网络异常，请检查网络', icon: 'none' })
        reject(error)
      }
    })
  })
}

async function request(options) {
  const normalized = Object.assign({ method: 'GET', data: {}, needAuth: true, silent: false, showLoading: false, timeout: REQUEST_TIMEOUT }, options)
  const requestId = normalized.requestId || createRequestId()
  if (normalized.showLoading) wx.showLoading({ title: typeof normalized.showLoading === 'string' ? normalized.showLoading : '加载中...', mask: true })
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await execute(normalized, requestId)
      } catch (error) {
        if (!shouldRetry(error, attempt, normalized)) throw error
        await wait(300 * Math.pow(2, attempt))
      }
    }
  } finally {
    if (normalized.showLoading) wx.hideLoading()
  }
}

function getWsUrl() {
  return BASE_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/api\/v1\/?$/, '/ws')
}

module.exports = {
  get: (url, data, needAuth, opts) => request({ url, method: 'GET', data, needAuth, ...opts }),
  post: (url, data, needAuth, opts) => request({ url, method: 'POST', data, needAuth, ...opts }),
  put: (url, data, needAuth, opts) => request({ url, method: 'PUT', data, needAuth, ...opts }),
  del: (url, data, needAuth, opts) => request({ url, method: 'DELETE', data, needAuth, ...opts }),
  BASE_URL,
  USE_MOCK,
  getWsUrl,
  sanitizeQuery
}
