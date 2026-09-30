const fs = require('fs')
const axios = require('axios')
const FormData = require('form-data')
const wechatConfig = require('../config/wechat')
const { getAccessToken, invalidateAccessToken } = require('../utils/wechatToken')

// sharp 是可选的原生依赖，缺失时小图仍可直接识别，大图才报错提示
let sharp = null
try {
  sharp = require('sharp')
} catch (e) {
  console.warn('[ScheduleOcr] sharp 不可用，超过 1MB 的课表截图将无法识别:', e.message.split('\n')[0])
}

// 微信 cv/ocr/comm 要求图片小于 1MB。压到 900KB 留出余量；
// 分辨率上限给到 2048 而不是沿用内容安全检测的 1080——课表截图是长图，
// 缩得太小文字会糊掉，直接影响识别率。
const OCR_MAX_BYTES = 900 * 1024
const OCR_MAX_DIMENSION = 2048
const TOKEN_RETRY_CODES = [40001, 40014, 42001]
// 微信 OCR 免费额度有限（以微信侧实际配额为准），内存计数做一道本地保护，
// 超出后直接给用户明确提示，而不是继续打微信接口等 45009。
const OCR_DAILY_LIMIT = Math.max(
  1,
  Math.min(100000, parseInt(process.env.SCHEDULE_OCR_DAILY_LIMIT, 10) || 200),
)

const dailyCounter = { date: '', used: 0 }

function takeQuota() {
  const today = new Date().toISOString().slice(0, 10)
  if (dailyCounter.date !== today) {
    dailyCounter.date = today
    dailyCounter.used = 0
  }
  if (dailyCounter.used >= OCR_DAILY_LIMIT) return false
  dailyCounter.used += 1
  return true
}

// 在内容安全检测（生产环境会把长图压到 1080px）之前把原始上传内容留一份，
// OCR 识别用高清副本，避免长图被压缩后文字不可辨。
exports.captureOcrImageMiddleware = (req, res, next) => {
  if (req.file && req.file.path) {
    try {
      req.ocrImageBuffer = fs.readFileSync(req.file.path)
    } catch (e) {
      console.error('[ScheduleOcr] 读取上传文件失败:', e.message)
    }
  }
  next()
}

async function prepareOcrBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error('未收到有效的课表图片')
    error.status = 400; error.expose = true; throw error
  }
  if (!sharp) {
    if (buffer.length > OCR_MAX_BYTES) {
      const error = new Error('图片过大且服务器缺少压缩组件，请上传 1MB 内的截图')
      error.status = 400; error.expose = true; throw error
    }
    return buffer
  }
  try {
    let quality = 85
    let out = null
    for (let i = 0; i < 4; i++) {
      out = await sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: OCR_MAX_DIMENSION, height: OCR_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer()
      if (out.length <= OCR_MAX_BYTES) break
      quality = Math.max(45, Math.round(quality * 0.8))
    }
    if (!out || out.length > OCR_MAX_BYTES) {
      const error = new Error('图片无法压缩到识别限制内，请裁剪后重新上传')
      error.status = 400; error.expose = true; throw error
    }
    return out
  } catch (e) {
    if (e.expose) throw e
    // 客户端伪造 mimetype 时可能上传非图片内容，sharp 解析失败归一化为 400
    console.error('[ScheduleOcr] 图片解析失败:', e.message)
    const error = new Error('图片内容无法解析，请上传清晰的课表截图')
    error.status = 400; error.expose = true; throw error
  }
}

async function wechatPrintedOcr(buffer, attempt = 0) {
  const token = await getAccessToken()
  const form = new FormData()
  form.append('img', buffer, { filename: 'schedule.jpg', contentType: 'image/jpeg' })
  let data
  try {
    ({ data } = await axios.post(
      `https://api.weixin.qq.com/cv/ocr/comm?access_token=${token}`,
      form,
      { headers: form.getHeaders(), timeout: 20000, maxContentLength: 6 * 1024 * 1024 },
    ))
  } catch (cause) {
    console.error('[ScheduleOcr] request failed:', cause.response?.data || cause.message)
    const error = new Error('课表识别服务请求失败，请稍后重试')
    error.status = 503; error.expose = true; throw error
  }
  const code = Number(data && data.errcode || 0)
  if (TOKEN_RETRY_CODES.includes(code) && attempt === 0) {
    invalidateAccessToken(token)
    return wechatPrintedOcr(buffer, 1)
  }
  return data
}

// 兼容返回结构变化：文本优先取 items[].text（通用印刷体接口的既有格式）
function extractOcrLines(data) {
  if (!data) return []
  if (Array.isArray(data.items)) {
    return data.items
      .map((item) => String((item && item.text) || '').trim())
      .filter(Boolean)
  }
  return []
}

function mapOcrError(code, errmsg) {
  if (code === 45009 || /quota/i.test(String(errmsg))) {
    const error = new Error('今日课表识别次数已用完，请明天再试或手动录入课程')
    error.status = 503; error.expose = true; return error
  }
  console.error('[ScheduleOcr] WeChat response:', { errcode: code, errmsg })
  const error = new Error('课表识别服务暂时不可用，请稍后重试')
  error.status = 503; error.expose = true; return error
}

// 输入原始图片 Buffer，返回 { lines, rawText }。lines 为逐行识别文本，
// rawText 以换行拼接，直接交给 scheduleController.parseOcrText 做结构化。
exports.recognizeScheduleImage = async (imageBuffer) => {
  if (!takeQuota()) {
    const error = new Error('今日课表识别次数已用完，请明天再试或手动录入课程')
    error.status = 503; error.expose = true; throw error
  }
  const prepared = await prepareOcrBuffer(imageBuffer)
  const data = await wechatPrintedOcr(prepared)
  const code = Number(data && data.errcode || 0)
  if (code !== 0) throw mapOcrError(code, data && data.errmsg)
  const lines = extractOcrLines(data)
  return { lines, rawText: lines.join('\n') }
}

// 微信 OCR 依赖 appid/appsecret，未配置时提前给出明确提示
exports.isConfigured = () =>
  !!(wechatConfig.appId && wechatConfig.appId !== 'your_appid' &&
     wechatConfig.appSecret && wechatConfig.appSecret !== 'your_appsecret')
