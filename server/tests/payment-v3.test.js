const assert = require('assert')
const crypto = require('crypto')
const payConfig = require('../config/wechatPay')
const pay = require('../services/wechatPayV3Service')

const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
payConfig.appId = 'wx_test_app'
payConfig.mchId = '1900000001'
payConfig.serialNo = 'SERIAL_TEST'
payConfig.notifyUrl = 'https://example.test/api/v1/payment/notify'
payConfig.privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' })

const auth = pay.authorization('GET', '/v3/pay/transactions/out-trade-no/ORDER?mchid=1900000001', '')
assert.ok(auth.startsWith('WECHATPAY2-SHA256-RSA2048 '))
assert.ok(auth.includes('mchid="1900000001"'))

const timestamp = String(Math.floor(Date.now() / 1000))
const nonce = 'testnonce'
const rawBody = '{"id":"event-test"}'
const signature = crypto.sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`), pair.privateKey).toString('base64')
payConfig.platformPublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' })
assert.strictEqual(pay.verifyCallback({ 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-signature': signature }, rawBody), true)
assert.strictEqual(pay.verifyCallback({ 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-signature': 'invalid' }, rawBody), false)

const apiV3Key = '0123456789abcdef0123456789abcdef'
const key = Buffer.from(apiV3Key)
const resourceNonce = Buffer.from('123456789012')
const associatedData = 'transaction'
const plaintext = JSON.stringify({ out_trade_no: 'ORDER', trade_state: 'SUCCESS' })
const cipher = crypto.createCipheriv('aes-256-gcm', key, resourceNonce)
cipher.setAAD(Buffer.from(associatedData))
const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
payConfig.apiV3Key = apiV3Key
assert.deepStrictEqual(pay.decryptResource({ nonce: resourceNonce.toString('utf8'), associated_data: associatedData, ciphertext }), JSON.parse(plaintext))

console.log('Payment v3 tests passed.')
