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

exports.uploadImage = async (req, res) => {
  if (!req.file) return fail(res, 'No file uploaded')
  try {
    await checkImage(req.file.path)
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY || !process.env.COS_BUCKET) {
        throw Object.assign(new Error('COS 对象存储未配置'), { status: 503, expose: true })
      }
      const Key = 'uploads/' + req.file.filename
      await putObject({ Key, Body: fs.createReadStream(req.file.path), ContentType: req.file.mimetype })
      fs.unlink(req.file.path, () => {})
      return success(res, { url: getPublicUrl(Key) })
    }
    success(res, { url: '/uploads/' + req.file.filename })
  } catch (error) {
    fs.unlink(req.file.path, () => {})
    fail(res, error.expose ? error.message : 'Image security check failed', error.status || 503)
  }
}
