const axios = require('axios')
const wechatConfig = require('../config/wechat')
const { fail } = require('./auth')

async function contentSecurity(req, res, next) {
  const textFields = ['content', 'title', 'desc', 'nickName']
  const contents = textFields.map(f => req.body[f]).filter(Boolean)
  if (contents.length === 0) return next()

  try {
    for (const content of contents) {
      if (wechatConfig.appId === 'your_appid') continue
      const tokenRes = await axios.get(
        `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${wechatConfig.appId}&secret=${wechatConfig.appSecret}`
      )
      const accessToken = tokenRes.data.access_token
      const checkRes = await axios.post(
        `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${accessToken}`,
        { content }
      )
      if (checkRes.data.errcode === 87014) {
        return fail(res, '内容含有违规信息', 400)
      }
    }
    next()
  } catch (e) {
    next()
  }
}

module.exports = contentSecurity
