const app = getApp

const BASE_URL = 'https://payun01.cn/api/v1'

// 所有请求均走真实服务端
const REQUEST_TIMEOUT = 15000
const READ_RETRY_COUNT = 2

function getAppInstance() {
  try { return app() } catch (e) { return { globalData: { token: '' } } }
}

function createRequestId() {
  return `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

// ===== 登录态失效的统一处理 =====
// 本地以为「已登录」（请求带了 Authorization）、服务端却回 401，说明 token 已失效。
// 此前这里只清本地 token、连提示都没有，调用方再传 silent:true（/schedule/list、
// /schedule/bind…）或 .catch(()=>{}) 的话，用户看到的就是「页面能进、数据全空」
// 或「点绑定并同步只弹一句未登录」，完全不知道要去重新登录。
// 现在统一弹一次「登录已失效 + 去登录」，并用冷却时间 + 弹窗互斥去重，
// 避免一屏多个并行请求各弹一次。
const LOGIN_EXPIRED_COOLDOWN_MS = 5 * 60 * 1000
let loginExpiredNotifiedAt = 0
let loginExpiredModalOpen = false

function notifyLoginExpired() {
  if (loginExpiredModalOpen) return
  const now = Date.now()
  if (now - loginExpiredNotifiedAt < LOGIN_EXPIRED_COOLDOWN_MS) return
  loginExpiredNotifiedAt = now
  loginExpiredModalOpen = true
  wx.showModal({
    title: '登录已失效',
    content: '登录状态已过期，请重新登录后继续使用',
    confirmText: '去登录',
    cancelText: '稍后',
    success(res) {
      loginExpiredModalOpen = false
      if (res.confirm) wx.navigateTo({ url: '/pages/login/index' })
    },
    fail() {
      loginExpiredModalOpen = false
    }
  })
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
  if (error.isFeatureDisabled) return false
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
          //
          // 但「请求带了 token 却被判 401」不是游客访问，而是登录态过期——
          // 必须明确告知并引导重新登录，否则用户会停在僵尸态里反复重试。
          if (hadToken) {
            // 顺带断开以旧身份建立的 WebSocket，避免继续收消息（游客本来就没有连接）
            if (typeof inst.onLogout === 'function') {
              try { inst.onLogout() } catch (e) { /* 清理失败不影响请求结果 */ }
            }
            notifyLoginExpired()
          } else if (!silent) {
            wx.showToast({ title: '未登录', icon: 'none' })
          }
          const error = new Error('未登录')
          error.statusCode = 401
          error.requiresLogin = true
          error.bizCode = 'UNAUTHORIZED'
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
        // 业务错误码：服务端约定把业务码放在 data.code（如 CAPTCHA_REQUIRED /
        // JW_CREDENTIAL_INVALID / CAPTCHA_EXPIRED），而 error.code 是 HTTP 状态码（409/400…）。
        // 二者混用会让页面永远匹配不到业务码（表现为「需要验证码却不跳转验证码页」），
        // 这里统一解析出 bizCode 供页面按业务语义分支。
        error.bizCode = (response.data && response.data.code) || (typeof response.code === 'string' ? response.code : '') || ''
        error.requestId = response.requestId || (res.header || {})['X-Request-Id'] || requestId
        error.response = response
        // 业务错误响应体（如验证码挑战数据），供调用方读取 err.data.code 等字段
        error.data = response.data
        // 管理后台停用功能模块时网关返回的 503 属预期状态：
        // 不弹 toast 打扰用户，也不进入重试队列（避免首页/课表页刷屏式报错）
        if (res.statusCode === 503 && response.code) error.isFeatureDisabled = true
        if (!silent && !error.isFeatureDisabled) wx.showToast({ title: error.message, icon: 'none' })
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
  getWsUrl,
  sanitizeQuery
}
