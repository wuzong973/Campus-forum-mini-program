const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const fs = require('fs')

// 服务器证书路径
const CERT_DIR = process.env.WX_PAY_CERT_DIR || '/www/wxpay_cert'

// 优先从环境变量读取私钥，若未设置则从证书文件读取
let privateKey = process.env.WX_PRIVATE_KEY || ''
if (!privateKey) {
  const keyPath = `${CERT_DIR}/apiclient_key.pem`
  if (fs.existsSync(keyPath)) {
    privateKey = fs.readFileSync(keyPath, 'utf8')
  }
}

module.exports = {
  appId: process.env.WX_APPID || 'your_appid',
  appSecret: process.env.WX_APPSECRET || 'your_appsecret',
  mchId: process.env.WX_MCH_ID || '',
  // 商户API私钥（用于服务端调用微信支付 v3 接口签名）
  privateKey,
  // 商户API证书路径（服务器部署路径）
  certPath: `${CERT_DIR}/apiclient_cert.pem`,
  p12Path: `${CERT_DIR}/apiclient_cert.p12`,
  // 微信支付 APIv3 密钥（用于回调通知解密，需从商户平台获取）
  apiV3Key: process.env.WX_APIV3_KEY || '',
  // 微信支付 APIv2 密钥（用于 v2 接口签名）
  apiV2Key: process.env.WX_APIV2_KEY || '',
  // 微信支付商户证书序列号（需从商户平台获取）
  serialNo: process.env.WX_SERIAL_NO || '',
  // 公钥ID（用于微信支付平台证书）
  publicKeyId: process.env.WX_PUBLIC_KEY_ID || '',
  platformPublicKey: process.env.WX_PLATFORM_PUBLIC_KEY || '',
  platformPublicKeyPath: process.env.WX_PLATFORM_PUBLIC_KEY_PATH || '',
  // 支付结果回调通知地址
  notifyUrl: process.env.WX_PAY_NOTIFY_URL || '',
  // 商家转账到零钱结果通知地址
  transferNotifyUrl: process.env.WX_TRANSFER_NOTIFY_URL || ''
}
