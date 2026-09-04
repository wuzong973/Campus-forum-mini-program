const axios = require('axios')
const wechatConfig = require('../config/wechat')

// 内存缓存 access_token，避免频繁调用微信接口（每日获取次数有限）
let cachedToken = null
let cachedExpireAt = 0
let refreshPromise = null

/**
 * 获取微信接口调用凭据 access_token（带内存缓存）
 * access_token 有效期 7200 秒，提前 300 秒刷新以防过期
 * @returns {Promise<string>}
 */
async function getAccessToken(options = {}) {
  const now = Date.now()
  if (options.forceRefresh) invalidateAccessToken(cachedToken)
  if (cachedToken && cachedExpireAt > now + 300 * 1000) {
    return cachedToken
  }
  if (refreshPromise) return refreshPromise
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${wechatConfig.appId}&secret=${wechatConfig.appSecret}`
  refreshPromise = axios.get(url, { timeout: 8000 }).then(({ data }) => {
    if (data.errcode) {
      const code = Number(data.errcode)
      const knownMessages = {
        40013: '微信 AppID 无效，请检查 WX_APPID',
        40125: '微信 AppSecret 无效，请检查 WX_APPSECRET',
        40164: '服务器出口 IP 不在微信 API 白名单中，请在微信公众平台添加该 IP'
      }
      const error = new Error(knownMessages[code] || ('获取access_token失败: ' + data.errmsg))
      error.wechatCode = code
      error.status = 503
      error.expose = true
      throw error
    }
    cachedToken = data.access_token
    cachedExpireAt = Date.now() + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000
    return cachedToken
  }).finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

function invalidateAccessToken(token) {
  if (!token || token === cachedToken) {
    cachedToken = null
    cachedExpireAt = 0
  }
}

module.exports = { getAccessToken, invalidateAccessToken }
