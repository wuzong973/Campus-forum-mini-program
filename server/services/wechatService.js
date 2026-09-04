const axios = require('axios')
const crypto = require('crypto')
const payConfig = require('../config/wechatPay')
const { getAccessToken } = require('../utils/wechatToken')

function privateKey() {
  return String(payConfig.privateKey || '').replace(/\\n/g, '\n')
}

function sign(message) {
  return crypto.sign('RSA-SHA256', Buffer.from(message), privateKey()).toString('base64')
}

async function createJsapiPayment({ orderNo, description, amountFen, openid }) {
  if (!payConfig.mchId || !payConfig.serialNo || !payConfig.notifyUrl || !privateKey()) {
    throw new Error('微信支付参数未配置完整')
  }
  const body = JSON.stringify({
    appid: payConfig.appId,
    mchid: payConfig.mchId,
    description,
    out_trade_no: orderNo,
    notify_url: payConfig.notifyUrl,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid },
  })
  const method = 'POST'
  const url = '/v3/pay/transactions/jsapi'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomBytes(16).toString('hex')
  const signature = sign(`${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`)
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${payConfig.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${payConfig.serialNo}"`
  const { data } = await axios.post(`https://api.mch.weixin.qq.com${url}`, body, {
    headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 10000,
  })
  const timeStamp = String(Math.floor(Date.now() / 1000))
  const nonceStr = crypto.randomBytes(16).toString('hex')
  const packageValue = `prepay_id=${data.prepay_id}`
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign: sign(`${payConfig.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`),
  }
}

function verifyPaymentCallback(headers, rawBody) {
  const publicKey = String(process.env.WX_PLATFORM_PUBLIC_KEY || '').replace(/\\n/g, '\n')
  if (!publicKey) throw new Error('未配置 WX_PLATFORM_PUBLIC_KEY')
  const timestamp = headers['wechatpay-timestamp']
  const nonce = headers['wechatpay-nonce']
  const signature = headers['wechatpay-signature']
  if (!timestamp || !nonce || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  return crypto.verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`), publicKey, Buffer.from(signature, 'base64'))
}

function decryptPaymentResource(resource) {
  const key = Buffer.from(payConfig.apiV3Key || '')
  if (key.length !== 32) throw new Error('WX_APIV3_KEY 必须为 32 字节')
  const ciphertext = Buffer.from(resource.ciphertext, 'base64')
  const authTag = ciphertext.subarray(ciphertext.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce))
  decipher.setAuthTag(authTag)
  decipher.setAAD(Buffer.from(resource.associated_data || ''))
  return JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'))
}

async function notifyRepairAdmins(order) {
  const templateId = process.env.WX_REPAIR_TEMPLATE_ID || ''
  const openids = String(process.env.WX_ADMIN_OPENIDS || '').split(',').map((v) => v.trim()).filter(Boolean)
  if (!templateId || !openids.length) throw new Error('管理员订阅消息参数未配置')
  const token = await getAccessToken()
  const data = {
    thing1: { value: `${order.device_type}-${order.fault_type}`.slice(0, 20) },
    thing2: { value: order.service_address.slice(0, 20) },
    time3: { value: new Date(order.appointment_time).toISOString().slice(0, 16).replace('T', ' ') },
    name4: { value: order.contact_name.slice(0, 10) },
    phone_number5: { value: order.contact_phone },
  }
  const results = await Promise.allSettled(openids.map((touser) => axios.post(
    `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
    { touser, template_id: templateId, page: process.env.WX_REPAIR_TEMPLATE_PAGE || 'pages/repair/index', data },
    { timeout: 8000 },
  ).then(({ data: response }) => {
    if (response.errcode) throw new Error(`${response.errcode}: ${response.errmsg}`)
  })))
  if (!results.some((result) => result.status === 'fulfilled')) throw results[0].reason
}

async function notifyRepairTechnician(order, technician) {
  if (!technician || !technician.openid) throw new Error('所选维修人员尚未登录小程序，无法发送订阅通知')
  const templateId = process.env.WX_REPAIR_TEMPLATE_ID || ''
  if (!templateId) throw new Error('维修订阅消息模板未配置')
  const token = await getAccessToken()
  const data = {
    thing1: { value: `${order.device_type}-待检测`.slice(0, 20) },
    thing2: { value: order.service_address.slice(0, 20) },
    time3: { value: new Date(order.appointment_time).toISOString().slice(0, 16).replace('T', ' ') },
    name4: { value: order.contact_name.slice(0, 10) },
    phone_number5: { value: order.contact_phone }
  }
  const { data: response } = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
    { touser: technician.openid, template_id: templateId, page: process.env.WX_REPAIR_TEMPLATE_PAGE || 'pages/repair/index', data },
    { timeout: 8000 }
  )
  if (response.errcode) throw new Error(`${response.errcode}: ${response.errmsg}`)
}

module.exports = { createJsapiPayment, verifyPaymentCallback, decryptPaymentResource, notifyRepairAdmins, notifyRepairTechnician }
