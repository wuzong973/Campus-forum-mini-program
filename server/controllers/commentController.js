const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')

exports.list = async (req, res) => {
  const postId = req.query.postId
  const page = parseInt(req.query.page, 10) || 1
  const pageSize = clampPageSize(req.query.pageSize, 50)
  const offset = (page - 1) * pageSize
  if (!postId) return fail(res, '缺少postId')
  try {
    const [countRows] = await pool.query('SELECT COUNT(*) as total FROM forum_comment WHERE post_id = ? AND status = 1', [postId])
    const [rows] = await pool.query(
      'SELECT c.*, u.nick_name, u.avatar_url FROM forum_comment c LEFT JOIN sys_user u ON c.user_id = u.id WHERE c.post_id = ? AND c.status = 1 ORDER BY c.created_at ASC LIMIT ? OFFSET ?',
      [postId, pageSize, offset]
    )
    const total = countRows[0].total
    success(res, { list: rows, total, hasMore: offset + pageSize < total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.create = async (req, res) => {
  const { postId, content, parentId } = req.body
  if (!postId || !content || !content.trim()) return fail(res, '参数不完整')
  try {
    const [posts] = await pool.query('SELECT id FROM forum_post WHERE id = ? AND status = 1', [postId])
    if (!posts.length) return fail(res, '帖子不存在', 404)
    const [result] = await pool.query(
      'INSERT INTO forum_comment (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)',
      [postId, req.userId, content.trim(), parentId || 0]
    )
    await pool.query('UPDATE forum_post SET comment_count = comment_count + 1 WHERE id = ?', [postId])
    success(res, { id: result.insertId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.remove = async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE forum_comment SET status = 0 WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!result.affectedRows) return fail(res, '无权删除', 403)
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
