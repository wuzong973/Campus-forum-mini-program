const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { success, fail } = require('../middleware/auth')

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
    else cb(new Error('仅支持图片上传'))
  }
})

exports.uploadMiddleware = upload.single('file')
exports.uploadScheduleImageMiddleware = upload.single('image')

exports.uploadImage = (req, res) => {
  if (!req.file) return fail(res, '未收到文件')
  const url = '/uploads/' + req.file.filename
  success(res, { url })
}
