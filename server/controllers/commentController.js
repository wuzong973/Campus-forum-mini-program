const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { createNotification } = require('../services/notificationService')

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch (e) { return null }
}

function parseAnonymousIdentity(identity) {
  const value = parseJson(identity)
  if (!value || !value.nickName || !value.avatarUrl) return null
  const avatarUrl = String(value.avatarUrl).trim()
  if (!avatarUrl.startsWith('/avatar1/')) return null
  return { nickName: String(value.nickName).trim().slice(0, 32), avatarUrl }
}

function presentComment(row) {
  const anonymousIdentity = parseAnonymousIdentity(row.anonymous_identity)
  return Object.assign({}, row, {
    nick_name: anonymousIdentity ? anonymousIdentity.nickName : row.nick_name,
    avatar_url: anonymousIdentity ? anonymousIdentity.avatarUrl : row.avatar_url,
    is_anonymous: !!anonymousIdentity,
  })
}

exports.list = async (req, res) => {
  const postId = req.query.postId
  const page = parseInt(req.query.page, 10) || 1
  const pageSize = clampPageSize(req.query.pageSize, 50)
  const sort = req.query.sort === 'time' ? 'time' : 'hot'
  const offset = (page - 1) * pageSize
  if (!postId) return fail(res, '缺少postId')
  try {
    const [countRows] = await pool.query('SELECT COUNT(*) as total FROM forum_comment WHERE post_id = ? AND status = 1', [postId])
    const userId = req.userId || 0
    const [rows] = await pool.query(
      `SELECT c.*, u.nick_name, u.avatar_url,
        (SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(fc2.anonymous_identity, '$.nickName')), u2.nick_name) FROM forum_comment fc2 LEFT JOIN sys_user u2 ON fc2.user_id = u2.id WHERE fc2.id = c.parent_id) AS parent_nick_name,
        IF(EXISTS(SELECT 1 FROM forum_comment_like WHERE comment_id = c.id AND user_id = ?), 1, 0) AS is_liked
       FROM forum_comment c LEFT JOIN sys_user u ON c.user_id = u.id WHERE c.post_id = ? AND c.status = 1 ORDER BY ${sort === 'time' ? 'c.created_at DESC' : 'c.like_count DESC, c.created_at ASC'} LIMIT ? OFFSET ?`,
      [userId, postId, pageSize, offset]
    )
    const total = countRows[0].total
    success(res, { list: rows.map(presentComment), total, hasMore: offset + pageSize < total })
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
      const [comments] = await pool.query('SELECT user_id, post_id, content FROM forum_comment WHERE id = ?', [commentId])
      if (comments.length && Number(comments[0].user_id) !== Number(req.userId)) {
        createNotification({
          userId: comments[0].user_id,
          type: 'like',
          title: '你的评论收到了点赞',
          content: comments[0].content.slice(0, 200),
          relatedId: comments[0].post_id
        }).catch(() => {})
      }
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
      `SELECT c.id, c.like_count, c.user_id, c.images, c.anonymous_identity, u.nick_name, u.avatar_url
       FROM forum_comment c LEFT JOIN sys_user u ON c.user_id = u.id
       WHERE c.post_id = ? AND c.status = 1 AND c.like_count > 0
       ORDER BY c.like_count DESC, c.created_at ASC LIMIT 1`,
      [postId]
    )
    success(res, rows[0] ? presentComment(rows[0]) : null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.create = async (req, res) => {
  const { postId, content, parentId, images, anonymousIdentity } = req.body
  if (typeof content === 'string' && content.trim().length > 1000) return fail(res, '评论不能超过1000个字符')
  if (!postId || !content || !content.trim()) return fail(res, '参数不完整')
  try {
    const normalizedAnonymousIdentity = parseAnonymousIdentity(anonymousIdentity)
    if (anonymousIdentity && !normalizedAnonymousIdentity) return fail(res, '匿名身份格式不正确')
    const [posts] = await pool.query('SELECT id, user_id FROM forum_post WHERE id = ? AND status = 1', [postId])
    if (!posts.length) return fail(res, '帖子不存在', 404)
    const imagesJson = Array.isArray(images) ? JSON.stringify(images) : null
    const [result] = await pool.query(
      'INSERT INTO forum_comment (post_id, user_id, content, images, anonymous_identity, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
      [postId, req.userId, content.trim(), imagesJson, normalizedAnonymousIdentity ? JSON.stringify(normalizedAnonymousIdentity) : null, parentId || 0]
    )
    await pool.query('UPDATE forum_post SET comment_count = comment_count + 1 WHERE id = ?', [postId])
    if (Number(posts[0].user_id) !== Number(req.userId)) {
      createNotification({
        userId: posts[0].user_id,
        type: 'comment',
        title: '你的帖子有新评论',
        content: content.trim().slice(0, 200),
        relatedId: postId
      }).catch(() => {})
    }
    success(res, { id: result.insertId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.update = async (req, res) => {
  const { content } = req.body
  if (typeof content === 'string' && content.trim().length > 1000) return fail(res, '评论不能超过1000个字符')
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
