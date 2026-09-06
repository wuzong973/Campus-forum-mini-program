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
      `SELECT n.id, n.type, n.title, n.content, n.related_id, n.is_read, n.created_at,
        n.actor_user_id, n.actor_nick, n.actor_avatar, n.post_title, n.comment_images,
        u2.nick_name AS actor_real_nick, u2.avatar_url AS actor_real_avatar,
        fp.title AS related_post_title
       FROM system_notification n
       LEFT JOIN sys_user u2 ON u2.id = n.actor_user_id
       LEFT JOIN forum_post fp ON n.type IN ('comment','like') AND fp.id = n.related_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, pageSize, offset]
    )
    success(res, {
      list: rows.map((item) => {
        // 匿名形象头像（avatar1 素材池）强制视为匿名：不返回真实用户 id，防止头像点击暴露匿名者身份
        const anonPersona = String(item.actor_avatar || '').indexOf('/assets/avatar1/') === 0
        let commentImages = []
        try {
          const parsed = JSON.parse(item.comment_images || 'null')
          if (Array.isArray(parsed)) commentImages = parsed
        } catch (e) {}
        return {
          id: item.id, type: item.type, title: item.title, content: item.content,
          relatedId: item.related_id, isRead: !!item.is_read, createdAt: item.created_at,
          // 互动通知展示信息：优先快照，历史通知回退到点赞者资料/帖子标题
          actorUserId: anonPersona ? 0 : (item.actor_user_id || 0),
          actorNick: item.actor_nick || item.actor_real_nick || '',
          actorAvatar: item.actor_avatar || item.actor_real_avatar || '',
          postTitle: item.post_title || item.related_post_title || '',
          commentImages
        }
      }),
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
