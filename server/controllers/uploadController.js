const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { success, fail } = require('../middleware/auth')
const axios = require('axios')
const FormData = require('form-data')
const wechatConfig = require('../config/wechat')
const { getAccessToken, invalidateAccessToken } = require('../utils/wechatToken')
const { putObject, getPublicUrl } = require('../config/cos')

// sharp 是可选的原生依赖，缺失时服务仍应正常启动，仅在需要压缩时才报错
let sharp = null
try {
  sharp = require('sharp')
} catch (e) {
  console.warn('[ImageUpload] sharp 不可用，超过 1MB 的图片将无法压缩:', e.message.split('\n')[0])
}

// 对象存储不可用时可回退为本地磁盘：UPLOAD_STORAGE_DRIVER=disk
const storageDriver = String(process.env.UPLOAD_STORAGE_DRIVER || 'object').toLowerCase()
// 微信 img_sec_check 限制单张图片不超过 1MB，超出会返回 45002
const SCAN_MAX_BYTES = 1024 * 1024
const SCAN_MAX_DIMENSION = 1080
// 本地开发机出口 IP 无法加入微信 API 白名单，开发环境跳过内容安全检测
const securityCheckEnabled = process.env.NODE_ENV === 'production'

const uploadDir = path.join(__dirname, '../uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname || '.jpg'))
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('Only image uploads are supported'))
  }
})

exports.uploadMiddleware = upload.single('file')
exports.uploadScheduleImageMiddleware = upload.single('image')

exports.imageSecurityMiddleware = async (req, res, next) => {
  if (!req.file) return fail(res, 'No image uploaded')
  try {
    await compressForScan(req.file)
    await checkImage(req.file.path)
    next()
  } catch (error) {
    fs.unlink(req.file.path, () => {})
    console.error('[ImageUpload] failed:', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      status: error.status,
      response: error.response?.data || error.response
    })
    fail(res, error.expose ? error.message : '图片上传到对象存储失败，请检查 COS 权限和配置', error.status || 503)
  }
}

async function checkImage(filePath) {
  if (!securityCheckEnabled) return
  const configured = wechatConfig.appId && wechatConfig.appId !== 'your_appid' && wechatConfig.appSecret && wechatConfig.appSecret !== 'your_appsecret'
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      const error = new Error('内容安全服务未配置')
      error.status = 503; error.expose = true; throw error
    }
    return
  }
  let token = await getAccessToken()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const form = new FormData()
    form.append('media', fs.createReadStream(filePath))
    let data
    try {
      ({ data } = await axios.post(`https://api.weixin.qq.com/wxa/img_sec_check?access_token=${token}`, form, {
        headers: form.getHeaders(), timeout: 15000, maxContentLength: 6 * 1024 * 1024
      }))
    } catch (cause) {
      console.error('[ImageSecurity] request failed:', cause.response?.data || cause.message)
      const error = new Error('图片安全服务请求失败，请稍后重试')
      error.status = 503; error.expose = true; throw error
    }
    const code = Number(data && data.errcode || 0)
    if ([40001, 40014, 42001].includes(code) && attempt === 0) {
      invalidateAccessToken(token)
      token = await getAccessToken({ forceRefresh: true })
      continue
    }
    if (code === 87014) {
      const error = new Error('图片含有违规信息，请更换后重试')
      error.status = 400; error.expose = true; throw error
    }
    if (code !== 0) {
      console.error('[ImageSecurity] WeChat response:', data)
      const error = new Error(`图片安全服务错误: ${data.errmsg || code}`)
      error.status = 503; error.expose = true; throw error
    }
    return
  }
}

// 将超过 1MB 的图片压缩到微信 img_sec_check 的大小限制以内，压缩后就地覆盖，
// 磁盘/COS 中保存的也是压缩后的文件。
async function compressForScan(file) {
  if (!securityCheckEnabled) return
  if (fs.statSync(file.path).size <= SCAN_MAX_BYTES) return
  if (!sharp) {
    const error = new Error('图片超过 1MB 且服务器缺少图片压缩组件，请更换较小的图片')
    error.status = 400; error.expose = true; throw error
  }
  let quality = 80
  let maxDim = SCAN_MAX_DIMENSION
  let out = null
  for (let i = 0; i < 4; i++) {
    out = await sharp(file.path, { failOn: 'none' })
      .rotate()
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer()
    if (out.length <= SCAN_MAX_BYTES) break
    quality = Math.max(35, Math.round(quality * 0.7))
    maxDim = Math.max(480, Math.round(maxDim * 0.8))
  }
  if (!out || out.length > SCAN_MAX_BYTES) {
    const error = new Error('图片过大且无法压缩到检测限制内，请更换图片')
    error.status = 400; error.expose = true; throw error
  }
  const jpgPath = file.path.replace(/\.[^.]+$/, '') + '.jpg'
  fs.writeFileSync(jpgPath, out)
  if (jpgPath !== file.path) fs.unlinkSync(file.path)
  file.path = jpgPath
  file.filename = path.basename(jpgPath)
  file.mimetype = 'image/jpeg'
}

exports.uploadImage = async (req, res) => {
  if (!req.file) return fail(res, 'No file uploaded')
  try {
    await compressForScan(req.file)
    await checkImage(req.file.path)
    if (storageDriver === 'object') {
      if (!process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY || !process.env.COS_BUCKET) {
        throw Object.assign(new Error('COS 对象存储未配置'), { status: 503, expose: true })
      }
      const Key = 'uploads/' + req.file.filename
      await putObject({ Key, Body: fs.createReadStream(req.file.path), ContentType: req.file.mimetype })
      fs.unlink(req.file.path, () => {})
      return success(res, { url: getPublicUrl(Key) })
    }
    // disk 模式：文件保留在 server/uploads，由 nginx（生产）或 express 静态托管（开发）对外提供
    const base = String(process.env.UPLOAD_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    const url = base ? `${base}/uploads/${req.file.filename}` : `/uploads/${req.file.filename}`
    success(res, { url })
  } catch (error) {
    fs.unlink(req.file.path, () => {})
    console.error('[ImageUpload] failed:', error.expose ? error.message : error)
    fail(res, error.expose ? error.message : '图片上传失败，请稍后重试', error.status || 503)
  }
}
