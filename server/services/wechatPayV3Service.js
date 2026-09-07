const axios = require('axios')
const crypto = require('crypto')
const fs = require('fs')
const payConfig = require('../config/wechatPay')

function privateKey() {
  return String(payConfig.privateKey || '').replace(/\\n/g, '\n')
}

function assertConfigured() {
  if (!payConfig.appId || payConfig.appId === 'your_appid' || !payConfig.mchId || !payConfig.serialNo || !payConfig.notifyUrl || !privateKey()) {
    throw new Error('WeChat Pay v3 configuration is incomplete')
  }
}

function sign(message) {
  return crypto.sign('RSA-SHA256', Buffer.from(message), privateKey()).toString('base64')
}

function authorization(method, target, body) {
  assertConfigured()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomBytes(16).toString('hex')
  const signature = sign(`${method}\n${target}\n${timestamp}\n${nonce}\n${body}\n`)
  return `WECHATPAY2-SHA256-RSA2048 mchid="${payConfig.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${payConfig.serialNo}"`
}

async function request(method, target, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  try {
    const { data } = await axios({
      method,
      url: `https://api.mch.weixin.qq.com${target}`,
      data: payload === undefined ? undefined : body,
      headers: { Authorization: authorization(method, target, body), Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 10000,
    })
    return data
  } catch (e) {
    // 透出微信返回的具体错误体（code/message），否则上层只能看到 "status code 403" 这类无意义信息
    const resp = e && e.response
    if (resp) {
      const wxBody = resp.data || {}
      const err = new Error(`WeChat Pay ${target} failed (HTTP ${resp.status}) ${wxBody.code || ''} ${wxBody.message || e.message}`.trim())
      err.wxCode = wxBody.code || ''
      err.wxMessage = wxBody.message || ''
      err.wxStatus = resp.status
      throw err
    }
    throw e
  }
}

async function createJsapiPayment({ orderNo, description, amountFen, openid }) {
  if (!openid || !Number.isInteger(amountFen) || amountFen < 1) throw new Error('Invalid JSAPI payment arguments')
  const data = await request('POST', '/v3/pay/transactions/jsapi', {
    appid: payConfig.appId,
    mchid: payConfig.mchId,
    description: String(description).slice(0, 127),
    out_trade_no: orderNo,
    notify_url: payConfig.notifyUrl,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid },
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
    prepayId: data.prepay_id,
  }
}

function platformPublicKey() {
  let value = String(payConfig.platformPublicKey || '').replace(/\\n/g, '\n')
  if (!value && payConfig.platformPublicKeyPath && fs.existsSync(payConfig.platformPublicKeyPath)) value = fs.readFileSync(payConfig.platformPublicKeyPath, 'utf8')
  if (!value) throw new Error('WeChat Pay platform public key is not configured')
  return value
}

function verifyCallback(headers, rawBody) {
  const timestamp = headers['wechatpay-timestamp']
  const nonce = headers['wechatpay-nonce']
  const signature = headers['wechatpay-signature']
  if (!timestamp || !nonce || !signature || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  return crypto.verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`), platformPublicKey(), Buffer.from(signature, 'base64'))
}

function decryptResource(resource) {
  if (!resource || !resource.nonce || !resource.ciphertext) throw new Error('Invalid encrypted notification resource')
  const key = Buffer.from(payConfig.apiV3Key || '')
  if (key.length !== 32) throw new Error('WX_APIV3_KEY must be 32 bytes')
  const encrypted = Buffer.from(resource.ciphertext, 'base64')
  const tag = encrypted.subarray(encrypted.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce))
  decipher.setAuthTag(tag)
  decipher.setAAD(Buffer.from(resource.associated_data || ''))
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'))
}

function queryTransaction(orderNo) {
  return request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(payConfig.mchId)}`)
}

function createRefund({ transactionId, outTradeNo, outRefundNo, reason, totalFen, refundFen, notifyUrl }) {
  if (!transactionId && !outTradeNo) throw new Error('Transaction identifier is required')
  if (!Number.isInteger(totalFen) || !Number.isInteger(refundFen) || refundFen < 1 || refundFen > totalFen) throw new Error('Invalid refund amount')
  // 退款回调必须指向退款通知接口（/payment/refund/notify），
  // 不能落到支付通知接口（其只解析 trade_state，退款结果会被丢弃导致订单永远停在 REFUNDING）
  const callbackUrl = notifyUrl || payConfig.refundNotifyUrl || payConfig.notifyUrl
  return request('POST', '/v3/refund/domestic/refunds', {
    transaction_id: transactionId || undefined,
    out_trade_no: outTradeNo || undefined,
    out_refund_no: outRefundNo,
    reason: String(reason || 'Merchant refund').slice(0, 80),
    notify_url: callbackUrl,
    amount: { refund: refundFen, total: totalFen, currency: 'CNY' },
  })
}

function queryRefund(outRefundNo) {
  return request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`)
}

function createTransferBatch({ outBatchNo, outDetailNo, amountFen, openid, remark }) {
  if (!outBatchNo || !outDetailNo || !openid || !Number.isInteger(amountFen) || amountFen < 1) throw new Error('Invalid transfer arguments')
  if (!payConfig.transferNotifyUrl) throw new Error('WX_TRANSFER_NOTIFY_URL is not configured')
  return request('POST', '/v3/transfer/batches', {
    appid: payConfig.appId,
    out_batch_no: outBatchNo,
    batch_name: 'Campus wallet withdrawal',
    batch_remark: 'Campus wallet withdrawal',
    total_amount: amountFen,
    total_num: 1,
    notify_url: payConfig.transferNotifyUrl,
    transfer_detail_list: [{
      out_detail_no: outDetailNo,
      transfer_amount: amountFen,
      transfer_remark: String(remark || 'Wallet withdrawal').slice(0, 32),
      openid
    }]
  })
}

function isConfigured() {
  try {
    assertConfigured()
    return Boolean(payConfig.transferNotifyUrl)
  } catch (e) { return false }
}

// 新版「商家转账（用户确认收款）」发起转账：2025-01-15 之后开通的商户号只能用此接口，
// 返回 state=WAIT_USER_CONFIRM + package_info，需用户在小程序内确认收款后微信才打款
function createTransferBill({ outBillNo, amountFen, openid, remark, notifyUrl }) {
  if (!outBillNo || !openid || !Number.isInteger(amountFen) || amountFen < 1) throw new Error('Invalid transfer bill arguments')
  if (!payConfig.transferNotifyUrl) throw new Error('WX_TRANSFER_NOTIFY_URL is not configured')
  return request('POST', '/v3/fund-app/mch-transfer/transfer-bills', {
    appid: payConfig.appId,
    out_bill_no: outBillNo,
    transfer_scene_id: payConfig.transferSceneId || '1000',
    openid,
    transfer_amount: amountFen,
    transfer_remark: String(remark || 'Wallet withdrawal').slice(0, 32),
    notify_url: notifyUrl || payConfig.transferNotifyUrl,
    transfer_scene_report_infos: payConfig.transferSceneReportInfos
  })
}

// 按商户单号查询新版转账单状态
function queryTransferBill(outBillNo) {
  return request('GET', `/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/${encodeURIComponent(outBillNo)}`)
}

module.exports = { createJsapiPayment, verifyCallback, decryptResource, queryTransaction, createRefund, queryRefund, createTransferBatch, createTransferBill, queryTransferBill, authorization, isConfigured }
