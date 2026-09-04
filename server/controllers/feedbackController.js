const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')

const TYPES = ['功能建议', 'Bug反馈', '体验优化', '其他问题']

function normalizeImages(images) {
  if (!Array.isArray(images) || images.length > 4) return null
  const list = images.map((item) => String(item || '').trim()).filter(Boolean)
  if (list.length !== images.length || list.some((url) => url.length > 512 || !/^https:\/\//.test(url))) return null
  return list
}

exports.create = async (req, res) => {
  const body = req.body || {}
  const type = String(body.type || '').trim()
  const content = String(body.content || '').trim()
  const contact = String(body.contact || '').trim()
  const images = normalizeImages(body.images || [])
  if (!TYPES.includes(type)) return fail(res, '请选择有效的反馈类型')
  if (content.length < 10 || content.length > 500) return fail(res, '反馈内容应为10至500个字符')
  if (contact.length > 128) return fail(res, '联系方式不能超过128个字符')
  if (!images) return fail(res, '图片格式无效，请重新上传')

  try {
    const [result] = await pool.query(
      'INSERT INTO user_feedback (user_id, type, content, contact, images) VALUES (?, ?, ?, ?, ?)',
      [req.userId, type, content, contact, JSON.stringify(images)]
    )
    success(res, { id: result.insertId }, '反馈已提交')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

exports.report = async (req, res) => {
  const body = req.body || {}
  const targetType = String(body.targetType || '').trim()
  const targetId = Number(body.targetId)
  const reason = String(body.reason || '').trim()
  if (!['post', 'comment'].includes(targetType) || !Number.isInteger(targetId) || targetId < 1) return fail(res, '举报对象无效')
  if (reason.length < 2 || reason.length > 500) return fail(res, '举报原因应为2至500个字符')
  try {
    const [result] = await pool.query(
      'INSERT INTO content_report (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)',
      [req.userId, targetType, targetId, reason]
    )
    success(res, { id: result.insertId }, '举报已提交，我们会尽快处理')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

module.exports.normalizeImages = normalizeImages
