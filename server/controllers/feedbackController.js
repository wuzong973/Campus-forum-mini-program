const pool = require('../config/pool')
const { success, fail, hasPermission } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')
const { createNotification } = require('../services/notificationService')

const TYPES = ['功能建议', 'Bug反馈', '体验优化', '其他问题']

function parseImages(images) {
  if (Array.isArray(images)) return images.filter((item) => typeof item === 'string' && item)
  if (typeof images !== 'string') return []
  try {
    const parsed = JSON.parse(images)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item) : []
  } catch (e) {
    return []
  }
}

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

// 意见墙仅返回公开内容；联系方式始终只供管理员在后台处理时查看。
// 管理员回复（reply）与用户评论（feedback_comment）同样公开展示给所有用户。
exports.listPublic = async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(30, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20))
  const offset = (page - 1) * pageSize
  try {
    const [[count], [rows]] = await Promise.all([
      pool.query('SELECT COUNT(*) total FROM user_feedback'),
      pool.query(
        `SELECT f.id, f.user_id userId, f.type, f.content, f.images, f.status, f.reply, f.reply_user_id replyUserId, f.reply_at replyAt,
          ru.nick_name replyNickName, f.created_at createdAt,
          u.nick_name nickName, u.avatar_url avatarUrl
         FROM user_feedback f
         LEFT JOIN sys_user u ON u.id = f.user_id
         LEFT JOIN sys_user ru ON ru.id = f.reply_user_id
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT ? OFFSET ?`,
        [pageSize, offset]
      )
    ])
    // 一次性取回本页意见的全部用户评论，避免列表逐条查询
    const ids = rows.map((row) => row.id)
    let commentRows = []
    if (ids.length) {
      ;[commentRows] = await pool.query(
        `SELECT c.id, c.feedback_id feedbackId, c.user_id userId, c.reply_to replyTo, c.reply_to_nick replyToNick,
          c.content, c.created_at createdAt, u.nick_name nickName
         FROM feedback_comment c
         LEFT JOIN sys_user u ON u.id = c.user_id
         WHERE c.feedback_id IN (?)
         ORDER BY c.created_at ASC, c.id ASC`,
        [ids]
      )
    }
    const commentsByFeedback = {}
    for (const row of commentRows) {
      const list = commentsByFeedback[row.feedbackId] || (commentsByFeedback[row.feedbackId] = [])
      list.push({
        id: row.id,
        userId: row.userId,
        nickName: row.nickName || '校园同学',
        replyToNick: row.replyToNick || '',
        content: row.content,
        createdAt: row.createdAt
      })
    }
    const total = Number((count[0] && count[0].total) || 0)
    success(res, {
      list: rows.map((row) => {
        const comments = commentsByFeedback[row.id] || []
        return {
          id: row.id,
          userId: row.userId,
          type: row.type,
          content: row.content,
          images: parseImages(row.images),
          status: row.status,
          reply: row.reply || '',
          replyUserId: row.replyUserId || 0,
          replyAt: row.replyAt,
          replyNickName: row.replyNickName || '管理员',
          comments,
          commentCount: comments.length,
          createdAt: row.createdAt,
          nickName: row.nickName || '校园同学',
          avatarUrl: row.avatarUrl || '/assets/icons/avatar.png'
        }
      }),
      total,
      page,
      hasMore: offset + rows.length < total
    })
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 管理员回复意见：仅 content_admin/super_admin 可操作。回复后状态置为 replied（已回复），
// 只有管理员显式「已解决」才置为 resolved；通过站内通知（含 WebSocket 实时推送）告知提交人。
exports.reply = async (req, res) => {
  const feedbackId = Number(req.params.id)
  const content = String((req.body || {}).content || '').trim()
  if (!Number.isInteger(feedbackId) || feedbackId < 1) return fail(res, '意见不存在')
  if (content.length < 2 || content.length > 500) return fail(res, '回复内容应为2至500个字符')
  try {
    const [rows] = await pool.query('SELECT id, user_id FROM user_feedback WHERE id = ? LIMIT 1', [feedbackId])
    if (!rows.length) return fail(res, '意见不存在')
    await pool.query(
      "UPDATE user_feedback SET reply = ?, reply_user_id = ?, reply_at = NOW(), status = IF(status = 'resolved', 'resolved', 'replied') WHERE id = ?",
      [content, req.userId, feedbackId]
    )
    let replyNickName = '管理员'
    try {
      const [admins] = await pool.query('SELECT nick_name FROM sys_user WHERE id = ? LIMIT 1', [req.userId])
      if (admins.length && admins[0].nick_name) replyNickName = admins[0].nick_name
    } catch (e) { /* 昵称查询失败不阻断回复 */ }
    if (rows[0].user_id && Number(rows[0].user_id) !== Number(req.userId)) {
      await createNotification({
        userId: rows[0].user_id,
        type: 'system',
        title: '你的意见已被回复',
        content: content.slice(0, 100),
        relatedId: feedbackId
      }).catch(() => {})
    }
    success(res, { id: feedbackId, reply: content, replyNickName, replyAt: new Date().toISOString() }, '回复已发布')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 编辑管理员回复：仅回复者本人可改，回复时间随之更新；状态保持不变。
exports.updateReply = async (req, res) => {
  const feedbackId = Number(req.params.id)
  const content = String((req.body || {}).content || '').trim()
  if (!Number.isInteger(feedbackId) || feedbackId < 1) return fail(res, '意见不存在')
  if (content.length < 2 || content.length > 500) return fail(res, '回复内容应为2至500个字符')
  try {
    const [rows] = await pool.query('SELECT id, reply_user_id FROM user_feedback WHERE id = ? LIMIT 1', [feedbackId])
    if (!rows.length || !rows[0].reply_user_id) return fail(res, '回复不存在')
    if (Number(rows[0].reply_user_id) !== Number(req.userId)) return fail(res, '只能编辑自己的回复', 403)
    await pool.query('UPDATE user_feedback SET reply = ?, reply_at = NOW() WHERE id = ?', [content, feedbackId])
    success(res, { id: feedbackId, reply: content, replyAt: new Date().toISOString() }, '回复已更新')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 删除管理员回复：仅回复者本人可删；未解决的意见回到「待回复」，已解决状态保持不变。
exports.removeReply = async (req, res) => {
  const feedbackId = Number(req.params.id)
  if (!Number.isInteger(feedbackId) || feedbackId < 1) return fail(res, '意见不存在')
  try {
    const [rows] = await pool.query('SELECT id, reply_user_id FROM user_feedback WHERE id = ? LIMIT 1', [feedbackId])
    if (!rows.length || !rows[0].reply_user_id) return fail(res, '回复不存在')
    if (Number(rows[0].reply_user_id) !== Number(req.userId)) return fail(res, '只能删除自己的回复', 403)
    await pool.query("UPDATE user_feedback SET reply = NULL, reply_user_id = NULL, reply_at = NULL, status = IF(status = 'resolved', 'resolved', 'pending') WHERE id = ?", [feedbackId])
    success(res, { id: feedbackId }, '回复已删除')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 用户发表评论：直接评论意见（replyTo = 0）或回复某条评论（replyTo = 评论 id）。
// 回复管理员的回复时（replyTo = 0 且带 replyToNick），通知对象为该意见的管理员回复人。
exports.addComment = async (req, res) => {
  const feedbackId = Number(req.params.id)
  const body = req.body || {}
  const content = String(body.content || '').trim()
  const replyTo = Number(body.replyTo) || 0
  let replyToNick = String(body.replyToNick || '').trim()
  if (!Number.isInteger(feedbackId) || feedbackId < 1) return fail(res, '意见不存在')
  if (!content || content.length > 500) return fail(res, '评论内容应为1至500个字符')
  if (replyToNick.length > 64) replyToNick = replyToNick.slice(0, 64)
  try {
    const [feedbackRows] = await pool.query('SELECT id, user_id, reply_user_id FROM user_feedback WHERE id = ? LIMIT 1', [feedbackId])
    if (!feedbackRows.length) return fail(res, '意见不存在')
    let notifyUserId = 0
    let notifyTitle = '你的意见有新评论'
    if (replyTo > 0) {
      const [targets] = await pool.query(
        `SELECT c.user_id, u.nick_name FROM feedback_comment c
         LEFT JOIN sys_user u ON u.id = c.user_id
         WHERE c.id = ? AND c.feedback_id = ? LIMIT 1`,
        [replyTo, feedbackId]
      )
      if (!targets.length) return fail(res, '回复的评论不存在或已删除')
      replyToNick = targets[0].nick_name || '校园同学'
      notifyUserId = Number(targets[0].user_id) || 0
      notifyTitle = '你的评论有新回复'
    } else if (replyToNick) {
      // 回复的是管理员的回复
      notifyUserId = Number(feedbackRows[0].reply_user_id) || 0
      notifyTitle = '你的回复有新评论'
    } else {
      notifyUserId = Number(feedbackRows[0].user_id) || 0
    }
    const [result] = await pool.query(
      'INSERT INTO feedback_comment (feedback_id, user_id, reply_to, reply_to_nick, content) VALUES (?, ?, ?, ?, ?)',
      [feedbackId, req.userId, replyTo, replyToNick, content]
    )
    let nickName = '校园同学'
    try {
      const [users] = await pool.query('SELECT nick_name FROM sys_user WHERE id = ? LIMIT 1', [req.userId])
      if (users.length && users[0].nick_name) nickName = users[0].nick_name
    } catch (e) { /* 昵称查询失败不阻断评论 */ }
    if (notifyUserId && notifyUserId !== Number(req.userId)) {
      createNotification({
        userId: notifyUserId,
        type: 'system',
        title: notifyTitle,
        content: content.slice(0, 100),
        relatedId: feedbackId
      }).catch(() => {})
    }
    success(res, {
      id: result.insertId,
      userId: req.userId,
      nickName,
      replyTo,
      replyToNick,
      content,
      createdAt: new Date().toISOString()
    }, '评论已发布')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 删除评论：评论作者本人或管理员（content.manage 权限）可删。
exports.deleteComment = async (req, res) => {
  const commentId = Number(req.params.commentId)
  if (!Number.isInteger(commentId) || commentId < 1) return fail(res, '评论不存在')
  try {
    const [rows] = await pool.query('SELECT id, feedback_id, user_id FROM feedback_comment WHERE id = ? LIMIT 1', [commentId])
    if (!rows.length) return fail(res, '评论不存在')
    if (Number(rows[0].user_id) !== Number(req.userId) && !hasPermission(req.user.role, 'content.manage')) {
      return fail(res, '只能删除自己的评论', 403)
    }
    await pool.query('DELETE FROM feedback_comment WHERE id = ?', [commentId])
    success(res, { id: commentId, feedbackId: rows[0].feedback_id }, '评论已删除')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 管理员标记意见状态：resolved（已解决）/ pending（取消解决）。
exports.setStatus = async (req, res) => {
  const feedbackId = Number(req.params.id)
  const status = String((req.body || {}).status || '').trim()
  if (!Number.isInteger(feedbackId) || feedbackId < 1) return fail(res, '意见不存在')
  if (!['resolved', 'pending'].includes(status)) return fail(res, '状态无效')
  try {
    const [result] = await pool.query('UPDATE user_feedback SET status = ? WHERE id = ?', [status, feedbackId])
    if (!result.affectedRows) return fail(res, '意见不存在')
    success(res, { id: feedbackId, status }, status === 'resolved' ? '已标记为已解决' : '已取消解决')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 编辑意见：仅作者本人可修改（管理员也不代改他人内容）；联系方式不在此接口内更新。
exports.update = async (req, res) => {
  const feedbackId = Number(req.params.id)
  const body = req.body || {}
  const type = String(body.type || '').trim()
  const content = String(body.content || '').trim()
  const images = normalizeImages(body.images || [])
  if (!Number.isInteger(feedbackId) || feedbackId < 1) return fail(res, '意见不存在')
  if (!TYPES.includes(type)) return fail(res, '请选择有效的反馈类型')
  if (content.length < 10 || content.length > 500) return fail(res, '反馈内容应为10至500个字符')
  if (!images) return fail(res, '图片格式无效，请重新上传')
  try {
    const [result] = await pool.query(
      'UPDATE user_feedback SET type = ?, content = ?, images = ? WHERE id = ? AND user_id = ?',
      [type, content, JSON.stringify(images), feedbackId, req.userId]
    )
    if (!result.affectedRows) return fail(res, '意见不存在或无权修改', 403)
    success(res, { id: feedbackId }, '意见已更新')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

// 删除意见：作者本人或管理员（content.manage 权限）可删。
exports.remove = async (req, res) => {
  const feedbackId = Number(req.params.id)
  if (!Number.isInteger(feedbackId) || feedbackId < 1) return fail(res, '意见不存在')
  try {
    const [rows] = await pool.query('SELECT id, user_id FROM user_feedback WHERE id = ? LIMIT 1', [feedbackId])
    if (!rows.length) return fail(res, '意见不存在')
    if (Number(rows[0].user_id) !== Number(req.userId) && !hasPermission(req.user.role, 'content.manage')) {
      return fail(res, '只能删除自己的意见', 403)
    }
    await pool.query('DELETE FROM user_feedback WHERE id = ?', [feedbackId])
    success(res, { id: feedbackId }, '意见已删除')
  } catch (error) {
    fail(res, safeMessage(error), 500)
  }
}

exports.report = async (req, res) => {
  const body = req.body || {}
  const targetType = String(body.targetType || '').trim()
  const targetId = Number(body.targetId)
  const reason = String(body.reason || '').trim()
  if (!['post', 'comment', 'user'].includes(targetType) || !Number.isInteger(targetId) || targetId < 1) return fail(res, '举报对象无效')
  if (reason.length < 2 || reason.length > 500) return fail(res, '举报原因应为2至500个字符')
  try {
    if (targetType === 'user') {
      if (targetId === req.userId) return fail(res, '不能举报自己')
      const [users] = await pool.query('SELECT id FROM sys_user WHERE id = ? AND status = 1 LIMIT 1', [targetId])
      if (!users.length) return fail(res, '被举报用户不存在')
    }
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
