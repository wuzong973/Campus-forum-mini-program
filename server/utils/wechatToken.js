const axios = require('axios')
const wechatConfig = require('../config/wechat')

/**
 * 微信「稳定版」接口调用凭据。
 *
 * 为什么不用 cgi-bin/token：
 * 该接口**每调用一次就签发一个新 token，并让上一次签发的立即失效**。
 * 本服务是 pm2 cluster 多实例（每个实例一份进程内缓存），实例 A 到期刷新后，
 * 实例 B 手里那个还没过期的 token 会立刻变成「invalid or not latest」，
 * 于是 B 发订阅消息时被微信以 40001 拒绝 —— 表现为「消息偶发发送失败」。
 *
 * cgi-bin/stable_token 是微信为分布式部署提供的版本：force_refresh=false 时，
 * 在有效期内反复调用都返回**同一个** token，多个实例互不作废。
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getStableAccessToken.html
 *
 * ⚠️ 注意 force_refresh=true 依然会作废其它实例正在使用的 token，
 * 因此只在「拿到 40001/42001、确认手里的凭据确实坏了」时才走强制刷新。
 */
const STABLE_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token'

// 提前 300 秒视为过期，避免边界上拿到「还剩几秒就失效」的 token
const REFRESH_MARGIN_MS = 300 * 1000

let cachedToken = null
let cachedExpireAt = 0
let refreshPromise = null

const KNOWN_ERRORS = {
  40013: '微信 AppID 无效，请检查 WX_APPID',
  40125: '微信 AppSecret 无效，请检查 WX_APPSECRET',
  40164: '服务器出口 IP 不在微信 API 白名单中，请在微信公众平台添加该 IP'
}

async function requestToken(force) {
  const { data } = await axios.post(STABLE_TOKEN_URL, {
    grant_type: 'client_credential',
    appid: wechatConfig.appId,
    secret: wechatConfig.appSecret,
    force_refresh: Boolean(force)
  }, { timeout: 8000 })

  if (!data || data.errcode) {
    const code = Number((data && data.errcode) || 0)
    const error = new Error(KNOWN_ERRORS[code] || ('获取access_token失败: ' + ((data && data.errmsg) || '空响应')))
    error.wechatCode = code
    error.status = 503
    error.expose = true
    throw error
  }

  cachedToken = data.access_token
  cachedExpireAt = Date.now() + Math.max(60, Number(data.expires_in || 7200)) * 1000
  return cachedToken
}

/**
 * 获取微信接口调用凭据 access_token（带进程内缓存）
 * @param {{ forceRefresh?: boolean }} [options]
 *   forceRefresh 会向微信请求一个全新 token（并作废其它实例手里的），
 *   仅用于 40001/42001 之后的自愈重试，常规路径不要传。
 * @returns {Promise<string>}
 */
async function getAccessToken(options = {}) {
  const force = Boolean(options.forceRefresh)

  if (!force && cachedToken && cachedExpireAt > Date.now() + REFRESH_MARGIN_MS) {
    return cachedToken
  }

  if (refreshPromise) {
    // 复用进行中的请求，避免并发打爆微信接口。
    // 但「强制刷新」不能被一个普通刷新顶掉 —— 否则拿回来的还是同一个坏 token。
    if (!force || refreshPromise.forced) return refreshPromise
    await refreshPromise.catch(() => {})
  }

  const pending = requestToken(force)
  pending.forced = force
  refreshPromise = pending
  try {
    return await pending
  } finally {
    if (refreshPromise === pending) refreshPromise = null
  }
}

function invalidateAccessToken(token) {
  if (!token || token === cachedToken) {
    cachedToken = null
    cachedExpireAt = 0
  }
}

module.exports = { getAccessToken, invalidateAccessToken, STABLE_TOKEN_URL }
