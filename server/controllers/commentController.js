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
    const userId = req.userId || 0
    const [rows] = await pool.query(
      `SELECT c.*, u.nick_name, u.avatar_url,
        (SELECT nick_name FROM sys_user WHERE id = c.parent_id) AS parent_nick_name,
        IF(EXISTS(SELECT 1 FROM forum_comment_like WHERE comment_id = c.id AND user_id = ?), 1, 0) AS is_liked
       FROM forum_comment c LEFT JOIN sys_user u ON c.user_id = u.id WHERE c.post_id = ? AND c.status = 1 ORDER BY c.like_count DESC, c.created_at ASC LIMIT ? OFFSET ?`,
      [userId, postId, pageSize, offset]
    )
    const total = countRows[0].total
    success(res, { list: rows, total, hasMore: offset + pageSize < total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.like = async (req, res) => {
  const commentId = parseInt(req.params.id, 10)
  if (!commentId) return fail(res, '缺少commentId')
  try {
    const [existing] = await pool.query('SELECT id FROM forum_comment_like WHERE comment_id = ? AND user_id = ?', [commentId, req.userId])
    if (existing.length) {
      // 已点赞，取消点赞
      await pool.query('DELETE FROM forum_comment_like WHERE comment_id = ? AND user_id = ?', [commentId, req.userId])
      await pool.query('UPDATE forum_comment SET like_count = GREATEST(0, like_count - 1) WHERE id = ?', [commentId])
      success(res, { liked: false })
    } else {
      // 点赞
      await pool.query('INSERT INTO forum_comment_like (comment_id, user_id) VALUES (?, ?)', [commentId, req.userId])
      await pool.query('UPDATE forum_comment SET like_count = like_count + 1 WHERE id = ?', [commentId])
      success(res, { liked: true })
    }
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.topLiked = async (req, res) => {
  const postId = req.query.postId
  if (!postId) return fail(res, '缺少postId')
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.like_count, c.user_id, u.nick_name, u.avatar_url
       FROM forum_comment c LEFT JOIN sys_user u ON c.user_id = u.id
       WHERE c.post_id = ? AND c.status = 1 AND c.like_count > 0
       ORDER BY c.like_count DESC, c.created_at ASC LIMIT 1`,
      [postId]
    )
    success(res, rows[0] || null)
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

exports.update = async (req, res) => {
  const { content } = req.body
  if (!content || !content.trim()) return fail(res, '内容不能为空')
  try {
    const [result] = await pool.query('UPDATE forum_comment SET content = ? WHERE id = ? AND user_id = ? AND status = 1', [content.trim(), req.params.id, req.userId])
    if (!result.affectedRows) return fail(res, '无权编辑或评论不存在', 403)
    success(res, null)
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
