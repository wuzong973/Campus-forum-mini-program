const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')

exports.list = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = clampPageSize(req.query.pageSize)
  const offset = (page - 1) * pageSize
  try {
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM system_notification WHERE user_id = ?', [req.userId])
    const [rows] = await pool.query(
      'SELECT id, type, title, content, related_id, is_read, created_at FROM system_notification WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.userId, pageSize, offset]
    )
    success(res, {
      list: rows.map((item) => ({
        id: item.id, type: item.type, title: item.title, content: item.content,
        relatedId: item.related_id, isRead: !!item.is_read, createdAt: item.created_at
      })),
      total: count.total,
      hasMore: offset + pageSize < count.total
    })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.markRead = async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!id) return fail(res, '通知不存在', 404)
  try {
    const [result] = await pool.query('UPDATE system_notification SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.userId])
    if (!result.affectedRows) return fail(res, '通知不存在', 404)
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.markAllRead = async (req, res) => {
  try {
    await pool.query('UPDATE system_notification SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.userId])
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
