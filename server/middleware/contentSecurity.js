const axios = require('axios')
const wechatConfig = require('../config/wechat')
const { getAccessToken, invalidateAccessToken } = require('../utils/wechatToken')
const { fail } = require('./auth')

const TEXT_KEYS = new Set(['content', 'title', 'desc', 'description', 'remark', 'nickName', 'signature', 'realName', 'name', 'value', 'contact', 'receiverName', 'pickupAddr', 'deliveryAddr', 'deliveryBuilding', 'deliveryRoom', 'serviceAddress', 'faultType', 'deviceType', 'type'])

function configured() {
  return wechatConfig.appId && wechatConfig.appId !== 'your_appid' && wechatConfig.appSecret && wechatConfig.appSecret !== 'your_appsecret'
}

function collectTexts(value, key, output) {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text && (!key || TEXT_KEYS.has(key))) output.push(text)
    return
  }
  if (Array.isArray(value)) return value.forEach((item) => collectTexts(item, key, output))
  if (value && typeof value === 'object') Object.keys(value).forEach((childKey) => collectTexts(value[childKey], childKey, output))
}

function sceneFor(req) {
  const path = `${req.baseUrl || ''}${req.path || ''}`
  if (path.includes('/comment') || path.includes('/review')) return 2
  if (path.includes('/post') || path.includes('/share') || path.includes('/errand')) return 3
  if (path.includes('/message')) return 4
  return 1
}

async function checkText(content, options = {}) {
  const text = String(content || '').trim()
  if (!text) return { suggest: 'pass', errcode: 0 }
  if (text.length > 2500) {
    const error = new Error('文本内容不能超过2500个字符')
    error.status = 400; error.expose = true; throw error
  }
  if (!configured()) {
    if (process.env.NODE_ENV === 'production') {
      const error = new Error('内容安全服务未配置')
      error.status = 503; error.expose = true; throw error
    }
    return { suggest: 'pass', errcode: 0, skipped: true }
  }
  let accessToken = await getAccessToken()
  let data
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await axios.post(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${accessToken}`, {
      version: 2, openid: options.openid, scene: options.scene || 3, content: text,
      nickname: options.nickname, title: options.title
    }, { timeout: 8000 })
    data = response.data
    const tokenExpired = [40001, 40014, 42001].includes(Number(data && data.errcode))
    if (!tokenExpired || attempt === 1) break
    invalidateAccessToken(accessToken)
    accessToken = await getAccessToken({ forceRefresh: true })
  }
  if (Number(data.errcode) === 87014 || (data.result && data.result.suggest && data.result.suggest !== 'pass')) {
    const error = new Error('内容含有违规信息，请修改后重试')
    error.status = 400; error.expose = true; throw error
  }
  if (Number(data.errcode || 0) !== 0) {
    const error = new Error(`内容安全服务错误: ${data.errmsg || data.errcode}`)
    error.status = 503; error.expose = true; throw error
  }
  return data
}

async function contentSecurity(req, res, next) {
  const texts = []
  collectTexts(req.body || {}, null, texts)
  try {
    const options = { openid: req.user && req.user.openid, scene: sceneFor(req), nickname: req.user && req.user.nick_name }
    for (const text of [...new Set(texts)]) await checkText(text, options)
    next()
  } catch (error) {
    return fail(res, error.expose ? error.message : '内容安全检测失败，请稍后重试', error.status || 503)
  }
}

/**
 * 聊天/私信发送专用：只对文本做 msg_sec_check。
 *
 * 图片、视频、表情包消息的 content 存的是上传后的 URL —— 媒体本身在上传链路已经
 * 过 img_sec_check（图片）或由举报/后台兜底（视频），再把 URL 当文本检测既没有意义，
 * 又会白烧每天的内容安全调用额度。
 */
function messageTextSecurity(req, res, next) {
  const msgType = String((req.body || {}).msgType || 'text')
  if (msgType !== 'text') return next()
  return contentSecurity(req, res, next)
}

module.exports = contentSecurity
module.exports.checkText = checkText
module.exports.collectTexts = collectTexts
module.exports.messageTextSecurity = messageTextSecurity
