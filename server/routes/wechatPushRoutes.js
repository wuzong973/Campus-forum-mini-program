const express = require('express')
const mediaCheck = require('../services/mediaCheckService')

const router = express.Router()

/**
 * 微信公众平台「消息推送」回调（本项目只消费媒体内容安全检测结果）。
 *
 * 配置方式：小程序后台 → 开发 → 开发设置 → 消息推送
 *   URL      = https://<域名>/api/v1/wechat/message
 *   Token    = 环境变量 WX_MESSAGE_TOKEN
 *   数据格式 = JSON，消息加密方式 = 明文模式
 *
 * GET  用于首次配置时的 echostr 校验；POST 接收事件推送。
 * 微信要求 5 秒内响应 "success"，因此事件处理走异步（不 await 后再应答）。
 */

// 校验失败一律 401，不泄露任何业务数据
function unauthorized(res) {
  return res.status(401).send('invalid signature')
}

router.get('/message', (req, res) => {
  if (!mediaCheck.verifySignature(req.query)) return unauthorized(res)
  res.send(String(req.query.echostr || ''))
})

router.post('/message', (req, res) => {
  if (!mediaCheck.verifySignature(req.query)) return unauthorized(res)
  const event = req.body && typeof req.body === 'object' ? req.body : {}
  if (event.Encrypt) {
    // 安全模式（AES 加密）需要额外配置 EncodingAESKey，本项目按明文模式接入
    console.warn('[WechatPush] 收到加密事件，请在小程序后台把消息加密方式改为明文模式')
    return res.send('success')
  }
  // 先应答，再处理：违规媒体的下线不影响微信侧判定
  res.send('success')
  Promise.resolve(mediaCheck.handleEvent(event)).catch((error) => {
    console.error('[WechatPush] 事件处理失败:', error.message)
  })
})

module.exports = router