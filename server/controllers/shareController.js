const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { parseImages, safeMessage } = require('../utils/helpers')

// 转发帖子
exports.create = async (req, res) => {
  const { postId, content, parentShareId } = req.body
  if (!postId) return fail(res, '参数不完整')
  try {
    // 检查原帖是否存在
    const [posts] = await pool.query('SELECT id, user_id FROM forum_post WHERE id = ? AND status = 1', [postId])
    if (!posts.length) return fail(res, '帖子不存在', 404)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [result] = await conn.query(
        'INSERT INTO forum_share (user_id, post_id, share_content, parent_share_id) VALUES (?, ?, ?, ?)',
        [req.userId, postId, (content || '').trim(), parentShareId || 0]
      )
      // 更新原帖的转发数
      await conn.query('UPDATE forum_post SET share_count = share_count + 1 WHERE id = ?', [postId])
      await conn.commit()
      success(res, { id: result.insertId })
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 获取帖子的转发列表
exports.list = async (req, res) => {
  const postId = req.params.id
  const page = parseInt(req.query.page, 10) || 1
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 50)
  const offset = (page - 1) * pageSize
  try {
    const [countRows] = await pool.query('SELECT COUNT(*) as total FROM forum_share WHERE post_id = ? AND status = 1', [postId])
    const [rows] = await pool.query(
      `SELECT s.*, u.nick_name, u.avatar_url,
        p.content AS original_content, p.images AS original_images,
        pu.nick_name AS original_nick_name, pu.avatar_url AS original_avatar_url
       FROM forum_share s
       LEFT JOIN sys_user u ON s.user_id = u.id
       LEFT JOIN forum_post p ON s.post_id = p.id
       LEFT JOIN sys_user pu ON p.user_id = pu.id
       WHERE s.post_id = ? AND s.status = 1
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [postId, pageSize, offset]
    )
    const total = countRows[0].total
    const list = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      nickName: r.nick_name,
      avatarUrl: r.avatar_url,
      shareContent: r.share_content,
      parentShareId: r.parent_share_id,
      originalContent: r.original_content,
      originalImages: parseImages(r.original_images),
      originalNickName: r.original_nick_name,
      originalAvatarUrl: r.original_avatar_url,
      createdAt: r.created_at
    }))
    success(res, { list, total, hasMore: offset + pageSize < total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 删除转发
exports.remove = async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE forum_share SET status = 0 WHERE id = ? AND user_id = ?', [req.params.id, req.userId])
    if (!result.affectedRows) return fail(res, '无权删除', 403)
    // 减少原帖转发数
    const [shares] = await pool.query('SELECT post_id FROM forum_share WHERE id = ? AND status = 0', [req.params.id])
    if (shares.length) {
      await pool.query('UPDATE forum_post SET share_count = GREATEST(share_count - 1, 0) WHERE id = ?', [shares[0].post_id])
    }
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
