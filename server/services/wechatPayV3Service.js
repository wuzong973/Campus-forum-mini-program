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
      // 强制 IPv4：服务器默认走 IPv6 出口，微信 IP 白名单只加了 IPv4 地址会报"此IP地址不允许调用接口"
      family: 4,
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

// 各转账场景要求的报备信息字段（信息类型为场景固定值，信息内容为业务自定义）
const TRANSFER_SCENE_PRESETS = {
  '1000': [{ info_type: '活动名称', info_content: '校园跑腿奖励' }, { info_type: '奖励说明', info_content: '跑腿订单收益提现' }],
  '1005': [{ info_type: '岗位类型', info_content: '跑腿接单员' }, { info_type: '报酬说明', info_content: '跑腿订单佣金提现' }],
}

// 新版「商家转账（用户确认收款）」发起转账：2025-01-15 之后开通的商户号只能用此接口，
// 返回 state=WAIT_USER_CONFIRM + package_info，需用户在小程序内确认收款后微信才打款
async function createTransferBill({ outBillNo, amountFen, openid, remark, notifyUrl }) {
  if (!outBillNo || !openid || !Number.isInteger(amountFen) || amountFen < 1) throw new Error('Invalid transfer bill arguments')
  if (!payConfig.transferNotifyUrl) throw new Error('WX_TRANSFER_NOTIFY_URL is not configured')
  // 依次尝试：环境变量配置的场景 → 常见已开通场景。报"尚未获取该转账场景"时换下一个
  const configured = String(payConfig.transferSceneId || '1000')
  const scenes = [configured]
  for (const sceneId of Object.keys(TRANSFER_SCENE_PRESETS)) {
    if (!scenes.includes(sceneId)) scenes.push(sceneId)
  }
  let lastError
  for (const sceneId of scenes) {
    const reportInfos = (sceneId === configured && payConfig.transferSceneReportInfos) || TRANSFER_SCENE_PRESETS[sceneId] || TRANSFER_SCENE_PRESETS[configured]
    const payload = {
      appid: payConfig.appId,
      out_bill_no: outBillNo,
      transfer_scene_id: sceneId,
      openid,
      transfer_amount: amountFen,
      transfer_remark: String(remark || 'Wallet withdrawal').slice(0, 32),
      notify_url: notifyUrl || payConfig.transferNotifyUrl,
      transfer_scene_report_infos: reportInfos,
    }
    try {
      return await request('POST', '/v3/fund-app/mch-transfer/transfer-bills', payload)
    } catch (error) {
      lastError = error
      const msg = String(error.wxMessage || '')
      // 场景未开通 / 场景报备信息不匹配 → 换下一个场景重试
      if (error.wxCode === 'INVALID_REQUEST' && msg.includes('场景')) continue
      if (error.wxCode === 'PARAM_ERROR' && (msg.includes('报备') || msg.includes('场景'))) continue
      throw error
    }
  }
  throw lastError
}

// 按商户单号查询新版转账单状态
function queryTransferBill(outBillNo) {
  return request('GET', `/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/${encodeURIComponent(outBillNo)}`)
}

// 把微信支付返回的原始错误翻译成管理员能直接照做的中文提示。
// 商家转账失败绝大多数是「商户侧资金/权限配置」问题，而不是程序 bug：
// 只把 "HTTP 403 NOT_ENOUGH" 透给后台，管理员根本无法判断该做什么，
// 所以这里必须给出 code（给前端分支用）、message（一句话结论）、hint（具体怎么做）。
function describeTransferError(error) {
  const wxCode = String((error && error.wxCode) || '')
  const wxMessage = String((error && error.wxMessage) || '')
  const wxStatus = Number((error && error.wxStatus) || 0)
  const raw = String((error && error.message) || '')
  const has = (...keywords) => keywords.some((word) => wxMessage.includes(word) || raw.includes(word))
  const pick = (code, message, hint) => ({ code, message, hint })

  // 1) 运营账户余额不足 —— 最常见的失败原因。
  //    微信「商家转账」只能从【运营账户】出款，用户付款/收款结算进入的是【基本账户】。
  //    关键：两个账户资金不通用，且自 2022 年底微信已取消「基本账户 → 运营账户」的划转，
  //    运营账户只能用银行卡充值（专款专用）。这里必须写清楚，否则管理员会以为
  //    "账上有钱就能提"，反复重试却一直失败。
  if (wxCode === 'NOT_ENOUGH' || has('运营账户', '资金不足')) {
    return pick(
      'WITHDRAW_CHANNEL_NOT_ENOUGH',
      '微信商户【运营账户】余额不足，转账被微信拒绝',
      '微信「商家转账」只能从【运营账户】出款；用户付款结算进入的是【基本账户】，两者资金不通用，'
      + '也不能互转（微信已取消基本账户向运营账户的划转）。请用银行卡向运营账户充值：'
      + '商户平台 → 交易中心 → 充值/转入 → 入款账户选「运营账户」→ 扫码充值或网银充值'
      + '（也可在 产品中心 → 资金解决方案 开通「转账充值」后用银行转账充值）。'
      + '充值到账后回到本页点「重试打款」；微信要求保持原商户单号，请勿新建提现申请。'
    )
  }
  // 2) 产品未开通 / 无调用权限
  if (wxCode === 'NO_AUTH' || wxStatus === 401) {
    return pick(
      'WITHDRAW_CHANNEL_NO_AUTH',
      '商户号未开通「商家转账」产品或接口无调用权限',
      '请登录微信支付商户平台 → 产品中心 开通「商家转账」；若已开通，请确认 API 证书序列号、'
      + '商户号（mchid）与当前商户一致，并检查「账户中心 → API 安全」中的调用 IP 白名单是否包含本服务器出口 IP。'
    )
  }
  if (wxStatus === 403) {
    return pick(
      'WITHDRAW_CHANNEL_FORBIDDEN',
      '微信拒绝了本次转账请求（无权限或参数不合法）',
      '请依次检查：① 商户平台「账户中心 → API 安全」的 IP 白名单是否包含服务器出口 IP；'
      + '② 转账场景 ID（transfer_scene_id）是否已在商户平台开通并报备；'
      + '③ API 证书序列号与私钥是否为同一套。原始返回：' + (wxCode || wxStatus) + ' ' + wxMessage
    )
  }
  // 3) 用户侧 openid 问题 —— 必须排在「场景/参数」通用分支之前：
  //    openid 不匹配时微信也返回 PARAM_ERROR，先判场景会把用户问题误报成商户配置问题
  if (has('openid', 'OPENID') || wxCode === 'OPENID_ERROR') {
    return pick(
      'WITHDRAW_USER_OPENID_INVALID',
      '用户微信身份（openid）与当前商户号不匹配',
      '该用户的 openid 可能是旧商户号/旧小程序下发的。请让用户重新进入小程序登录一次刷新 openid 后再发起提现。'
    )
  }
  // 4) 转账场景未开通 / 报备信息不符（createTransferBill 会先换场景重试，走到这里说明都失败了）
  if (has('场景', '报备') || wxCode === 'INVALID_REQUEST') {
    return pick(
      'WITHDRAW_CHANNEL_SCENE',
      '转账场景未开通或场景报备信息不符合微信要求',
      '请到微信支付商户平台 → 产品中心 → 商家转账 → 转账场景，开通「佣金报酬」等对应场景，'
      + '并按微信要求填写报备信息；也可通过环境变量 WX_TRANSFER_SCENE_ID 与 '
      + 'WX_TRANSFER_SCENE_REPORT_INFOS 指定场景与报备内容后重启服务。原始返回：' + (wxCode || '') + ' ' + wxMessage
    )
  }
  // 5) 频控与微信侧故障
  if (wxCode === 'FREQUENCY_LIMITED' || has('频率', '限流')) {
    return pick('WITHDRAW_CHANNEL_RATE_LIMIT', '触发微信转账频率限制', '请等待几分钟后点击「重试打款」再试，不要连续快速重试。')
  }
  if (wxCode === 'SYSTEM_ERROR' || (wxStatus >= 500 && wxStatus < 600)) {
    return pick('WITHDRAW_CHANNEL_SYSTEM_ERROR', '微信支付系统繁忙，转账未受理', '这属于微信侧临时故障，稍后点击「重试打款」即可（原单号重试安全）。')
  }
  if (wxCode === 'NOT_FOUND') {
    return pick('WITHDRAW_CHANNEL_NOT_FOUND', '微信侧查不到该转账单', '请确认商户号是否切换过；如为首次发起，可直接点击「重试打款」。')
  }
  return pick(
    'WITHDRAW_CHANNEL_ERROR',
    '微信转账失败：' + (wxCode || wxStatus || '未知错误'),
    (wxMessage || raw || '未返回具体原因') + '　可稍后点击「重试打款」；若持续失败，请携带本条原始信息联系微信支付客服。'
  )
}

module.exports = { createJsapiPayment, verifyCallback, decryptResource, queryTransaction, createRefund, queryRefund, createTransferBatch, createTransferBill, queryTransferBill, describeTransferError, authorization, isConfigured }
