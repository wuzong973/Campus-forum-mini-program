const axios = require('axios')
const wechatConfig = require('../config/wechat')

// 内存缓存 access_token，避免频繁调用微信接口（每日获取次数有限）
let cachedToken = null
let cachedExpireAt = 0

/**
 * 获取微信接口调用凭据 access_token（带内存缓存）
 * access_token 有效期 7200 秒，提前 300 秒刷新以防过期
 * @returns {Promise<string>}
 */
async function getAccessToken() {
  const now = Date.now()
  if (cachedToken && cachedExpireAt > now + 300 * 1000) {
    return cachedToken
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${wechatConfig.appId}&secret=${wechatConfig.appSecret}`
  const { data } = await axios.get(url)
  if (data.errcode) {
    throw new Error('获取access_token失败: ' + data.errmsg)
  }
  cachedToken = data.access_token
  cachedExpireAt = now + data.expires_in * 1000
  return cachedToken
}

module.exports = { getAccessToken }
