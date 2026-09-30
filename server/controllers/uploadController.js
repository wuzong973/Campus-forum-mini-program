const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { success, fail } = require('../middleware/auth')
const axios = require('axios')
const FormData = require('form-data')
const wechatConfig = require('../config/wechat')
const { getAccessToken, invalidateAccessToken } = require('../utils/wechatToken')
const { putObject, deleteObject, getPublicUrl } = require('../config/cos')
const mediaCheck = require('../services/mediaCheckService')
const rateLimit = require('../middleware/rateLimit')

// sharp 是可选的原生依赖，缺失时服务仍应正常启动，仅在需要压缩时才报错
let sharp = null
try {
  sharp = require('sharp')
} catch (e) {
  console.warn('[ImageUpload] sharp 不可用，超过 1MB 的图片将改走异步内容安全检测:', e.message.split('\n')[0])
}

// 对象存储不可用时可回退为本地磁盘：UPLOAD_STORAGE_DRIVER=disk
const storageDriver = String(process.env.UPLOAD_STORAGE_DRIVER || 'object').toLowerCase()
// 微信 img_sec_check 限制单张图片不超过 1MB，超出会返回 45002
const SCAN_MAX_BYTES = 1024 * 1024
const SCAN_MAX_DIMENSION = 1080
// media_check_async 的图片上限（官方 10MB），超过就只能拒绝
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

// 聊天视频上传：不做图片安全检测（微信没有视频同步检测接口），
// 由「真实文件类型校验 + 每日上传配额 + 举报/后台下架」共同兜底
const videoUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^video\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('Only video uploads are supported'))
  }
})

/**
 * 视频上传每日配额（P02 组合策略的一环）。
 *
 * 微信内容安全接口只覆盖文本 / 图片 / 音频，**没有视频检测入口**，
 * 所以视频只能靠「真实文件类型校验 + 每日配额 + 举报与后台下架」收敛风险：
 * 配额把单账号可批量投放的未检测视频压到可控规模，Redis 不可用时退回默认限流。
 */
const VIDEO_DAILY_LIMIT = Math.max(1, Number(process.env.VIDEO_UPLOAD_DAILY_LIMIT || 30))
const videoDailyQuota = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: VIDEO_DAILY_LIMIT,
  keyPrefix: 'video_upload:',
  message: `今日视频上传次数已达上限（${VIDEO_DAILY_LIMIT}次），请明天再试`
})

exports.uploadMiddleware = upload.single('file')
exports.uploadVideoMiddleware = videoUpload.single('file')
exports.uploadScheduleImageMiddleware = upload.single('image')

/* ============ 真实文件类型校验（不信任客户端 MIME / 扩展名） ============ */

const ascii = (buffer, from, to) => buffer.slice(from, to).toString('latin1')

// 只放行小程序真机能渲染的位图与容器；svg / html / 脚本等文本载荷一律拒绝，
// 否则同域 /uploads 直出就是存储型 XSS 与钓鱼跳板
const IMAGE_SIGNATURES = [
  { ext: '.jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', mime: 'image/png', test: (b) => ascii(b, 0, 4) === '\x89PNG' },
  { ext: '.gif', mime: 'image/gif', test: (b) => ascii(b, 0, 3) === 'GIF' },
  { ext: '.webp', mime: 'image/webp', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  { ext: '.bmp', mime: 'image/bmp', test: (b) => ascii(b, 0, 2) === 'BM' },
  // iOS 相机默认格式（HEIF 家族）：品牌名必须是图片类，否则与视频共用 ftyp 头会互相误判
  {
    ext: '.heic',
    mime: 'image/heic',
    test: (b) => ascii(b, 4, 8) === 'ftyp' && HEIF_IMAGE_BRANDS.indexOf(ascii(b, 8, 12)) >= 0,
  },
]

// HEIF/HEIC 兼容品牌（heic/heix/heim/hens/hevc/hev1/mif1/msf1）
const HEIF_IMAGE_BRANDS = ['heic', 'heix', 'heim', 'hens', 'hevc', 'hev1', 'mif1', 'msf1']

const VIDEO_SIGNATURES = [
  // ISO-BMFF：mp4 / mov / m4v，品牌 'qt  ' 是 QuickTime
  { ext: '.mp4', mime: 'video/mp4', test: (b) => ascii(b, 4, 8) === 'ftyp', refine: (b) => (ascii(b, 8, 12) === 'qt  ' ? { ext: '.mov', mime: 'video/quicktime' } : null) },
  { ext: '.webm', mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { ext: '.avi', mime: 'video/x-msvideo', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 11) === 'AVI' },
]

function sniffUpload(filePath, table) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(16)
    const bytes = fs.readSync(fd, head, 0, 16, 0)
    if (bytes < 12) return null
    for (const signature of table) {
      if (!signature.test(head)) continue
      return signature.refine ? Object.assign({}, signature, signature.refine(head)) : signature
    }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

// 校验并归一化：客户端声明的 MIME 族必须与真实文件头一致，落盘扩展名按真实类型改写
function assertRealFile(file, expectedKind) {
  const table = expectedKind === 'video' ? VIDEO_SIGNATURES : IMAGE_SIGNATURES
  const detected = sniffUpload(file.path, table)
  if (!detected) {
    const error = new Error(expectedKind === 'video' ? '视频文件已损坏或格式不支持，请重新录制后上传' : '图片文件已损坏或格式不支持，请重新选择图片')
    error.status = 400
    error.expose = true
    throw error
  }
  const declared = String(file.mimetype || '')
  const familyMismatch = expectedKind === 'video' ? !/^video\//.test(declared) : !/^image\//.test(declared)
  if (familyMismatch) {
    const error = new Error('文件类型与内容不符，请重新选择文件')
    error.status = 400
    error.expose = true
    throw error
  }
  // 扩展名/文件名与真实类型不一致时改写，避免以 .svg/.html 等名义被同域直出
  const currentExt = path.extname(file.path).toLowerCase()
  if (currentExt !== detected.ext) {
    const nextPath = `${file.path.slice(0, file.path.length - currentExt.length)}${detected.ext}`
    fs.renameSync(file.path, nextPath)
    file.path = nextPath
    file.filename = path.basename(nextPath)
  }
  file.mimetype = detected.mime
  return detected
}

function removeUploadedFile(file) {
  if (file && file.path) fs.unlink(file.path, () => {})
}

// 检测不过时把刚落盘的媒体撤回，避免「未检测但已可访问」的窗口留在对象存储里
async function rollbackStoredMedia(stored) {
  try {
    if (storageDriver === 'object' && stored.key) await deleteObject(stored.key)
    else if (stored.key && fs.existsSync(path.join(uploadDir, path.basename(stored.key)))) {
      fs.unlinkSync(path.join(uploadDir, path.basename(stored.key)))
    }
  } catch (error) {
    console.error('[ImageUpload] 回收未通过检测的媒体失败:', error.message)
  }
}

/* ============ 同步图片检测（wxa/img_sec_check） ============ */

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
    if (code === 41005 || code === 41006) {
      // 41005/41006：图片尺寸/格式不被同步接口支持 → 交给异步检测
      const error = new Error('图片尺寸超出同步检测限制')
      error.status = 400; error.expose = true; error.asyncFallback = true; throw error
    }
    if (code === 45009 || code === 45002) {
      const error = new Error('图片过大，无法同步检测')
      error.status = 400; error.expose = true; error.asyncFallback = true; throw error
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
// 返回 true = 已压到限制内；false = 压不了（缺 sharp 或压完仍超限），由调用方决定是否转异步检测。
async function compressForScan(file) {
  if (!securityCheckEnabled) return true
  if (fs.statSync(file.path).size <= SCAN_MAX_BYTES) return true
  if (!sharp) {
    console.warn('[ImageUpload] sharp 不可用，改走异步内容安全检测')
    return false
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
    console.warn('[ImageUpload] 图片压缩后仍超过同步检测限制，改走异步内容安全检测')
    return false
  }
  const jpgPath = file.path.replace(/\.[^.]+$/, '') + '.jpg'
  fs.writeFileSync(jpgPath, out)
  if (jpgPath !== file.path) fs.unlinkSync(file.path)
  file.path = jpgPath
  file.filename = path.basename(jpgPath)
  file.mimetype = 'image/jpeg'
  return true
}

// 上传文件落盘：优先对象存储，未配置时回退本地磁盘，返回可访问 URL 与对象 Key
async function storeUploadedFile(file) {
  if (storageDriver === 'object') {
    if (!process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY || !process.env.COS_BUCKET) {
      throw Object.assign(new Error('COS 对象存储未配置'), { status: 503, expose: true })
    }
    const Key = 'uploads/' + file.filename
    await putObject({ Key, Body: fs.createReadStream(file.path), ContentType: file.mimetype })
    fs.unlink(file.path, () => {})
    return { url: getPublicUrl(Key), key: Key }
  }
  // disk 模式：文件保留在 server/uploads，由 nginx（生产）或 express 静态托管（开发）对外提供
  const base = String(process.env.UPLOAD_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  const url = base ? `${base}/uploads/${file.filename}` : `/uploads/${file.filename}`
  return { url, key: `uploads/${file.filename}` }
}

exports.imageSecurityMiddleware = async (req, res, next) => {
  if (!req.file) return fail(res, 'No image uploaded')
  try {
    assertRealFile(req.file, 'image')
    // 课表 OCR 等「本地消费」型上传没有公开 URL，无法转异步检测，压不动就直接报错
    const compressible = await compressForScan(req.file)
    if (!compressible) {
      const error = new Error('图片超过 1MB 且服务器缺少图片压缩组件，请更换较小的图片')
      error.status = 400; error.expose = true; throw error
    }
    await checkImage(req.file.path)
    next()
  } catch (error) {
    removeUploadedFile(req.file)
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

exports.uploadImage = async (req, res) => {
  if (!req.file) return fail(res, 'No file uploaded')
  try {
    assertRealFile(req.file, 'image')
    // 同步检测优先（能压到 1MB 内就当场判定）；压不动 / 同步接口不支持尺寸时转异步检测
    let needsAsyncCheck = false
    if (securityCheckEnabled) {
      try {
        const compressible = await compressForScan(req.file)
        if (compressible) await checkImage(req.file.path)
        else needsAsyncCheck = true
      } catch (error) {
        if (!error.asyncFallback) throw error
        needsAsyncCheck = true
        console.warn('[ImageUpload] 同步检测不可用，转异步内容安全检测:', error.message)
      }
    }
    // 注意：storeUploadedFile 在 COS 模式下自行清理临时文件，disk 模式则要保留（它就是最终存储）
    const stored = await storeUploadedFile(req.file)
    if (needsAsyncCheck) {
      const submitted = await mediaCheck.submit({
        userId: req.userId,
        mediaUrl: stored.url,
        objectKey: stored.key,
        mediaType: 'image',
        openid: req.user && req.user.openid,
        scene: mediaCheck.SCENE_FORUM,
      })
      // 异步检测也不可用（未配回调 Token、接口报错）时**不放行未检测的大图**：
      // 内容安全是原设计意图，宁可让用户换小图，也不能把没检过的图公开出去。
      if (!submitted.submitted) {
        console.error('[ImageUpload] 大图既无法压缩也无法异步检测，已拒绝:', submitted.reason)
        await rollbackStoredMedia(stored)
        fail(res, '图片过大且无法完成安全检测，请压缩后重试或改用较小的图片', 400)
        return
      }
    }
    success(res, { url: stored.url })
  } catch (error) {
    removeUploadedFile(req.file)
    console.error('[ImageUpload] failed:', error.expose ? error.message : error)
    fail(res, error.expose ? error.message : '图片上传失败，请稍后重试', error.status || 503)
  }
}

exports.videoDailyQuota = videoDailyQuota

exports.uploadVideo = async (req, res) => {
  if (!req.file) return fail(res, 'No file uploaded')
  try {
    assertRealFile(req.file, 'video')
    const { url } = await storeUploadedFile(req.file)
    success(res, { url })
  } catch (error) {
    removeUploadedFile(req.file)
    console.error('[VideoUpload] failed:', error.expose ? error.message : error)
    fail(res, error.expose ? error.message : '视频上传失败，请稍后重试', error.status || 503)
  }
}
