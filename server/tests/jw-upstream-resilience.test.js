// H3 回归：教务系统前置 SLB 源站超时（实测学校侧间歇返回 504、少量 502）必须可重试，
// 并归一化为友好提示，避免把 axios 原文「Request failed with status code 504」抛给用户。
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')

const crawlerJs = read('jw-crawler', 'crawler.js')
const serviceJs = read('server', 'services', 'jwScheduleSyncService.js')

// 1. isRetryableError 必须覆盖 429/500/502/503/504 与常见网络错误
const retryFn = crawlerJs.slice(crawlerJs.indexOf('isRetryableError(err)'))
const retryBody = retryFn.slice(0, retryFn.indexOf('return false'))
for (const status of [429, 500, 502, 503, 504]) {
  assert.ok(new RegExp('status === ' + status).test(retryBody), `HTTP ${status} 必须可重试`)
}
for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EPIPE']) {
  assert.ok(retryBody.includes(code), `${code} 必须可重试`)
}

// 2. normalizeSyncError 必须把上游 5xx 归一化为 502 + 业务码（不能用 503：
//    小程序请求层把 503 当作「功能已停用」而静默不提示）
const syncErr = serviceJs.slice(serviceJs.indexOf('function normalizeSyncError'))
const upstreamBranch = syncErr.slice(0, syncErr.indexOf('验证码错误'))
assert.ok(/status code 50\\d/.test(upstreamBranch), '需识别上游 5xx 报文')
assert.ok(/result\.status = 502/.test(upstreamBranch), '上游超时应归一化为 502')
assert.ok(/JW_UPSTREAM_UNAVAILABLE/.test(upstreamBranch), '需给出业务码 JW_UPSTREAM_UNAVAILABLE')
assert.ok(!/result\.status = 503/.test(upstreamBranch), '不得使用 503（会被小程序当作功能停用而静默）')

// 3. 环境变量样例需记录容错参数
const envExample = read('server', '.env.example')
for (const key of ['JW_TIMEOUT_MS', 'JW_MAX_RETRIES', 'JW_RETRY_BACKOFF_MS']) {
  assert.ok(envExample.includes(key), `.env.example 需包含 ${key}`)
}

// 4. 学校抖动返回 HTML（而非图片）时的两处防护：
//    ① crawler 的 OCR 调用必须捕获异常（否则 sharp 报 unsupported image format → 500）
//    ② 挑战创建必须校验图片魔数，非图片不下发给用户
const crawlerTryCatch = (crawlerJs.match(/try \{\s*const ocrResult = await this\.recognizeCaptcha\(/g) || []).length
assert.strictEqual(crawlerTryCatch, 2, '两条登录路径的 OCR 调用都必须包 try/catch，实际 ' + crawlerTryCatch)
assert.ok(/OCR 失败（按识别失败处理，转人工验证码）/.test(crawlerJs), 'OCR 异常需降级为人工验证码并打印说明')
assert.ok(/function isImageBuffer\(/.test(serviceJs), 'service 需提供 isImageBuffer 魔数校验')
assert.ok(/if \(isImageBuffer\(captchaBuffer\)\) break;/.test(serviceJs), '挑战创建需校验验证码是否为图片')
assert.ok(/JW_CAPTCHA_NOT_IMAGE/.test(serviceJs), '非图片应抛出明确业务码，而非把 HTML 下发')
assert.ok(/attempt <= 2/.test(serviceJs), '非图片时应重抓一次')

console.log('JW upstream resilience test passed.')
