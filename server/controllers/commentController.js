const pool = require('../config/pool')
const { success, fail, hasPermission } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { createNotification, withMediaPlaceholder } = require('../services/notificationService')
const { normalizeLegacyAvatarUrl, normalizeAnonymousAvatarUrl, isAnonymousAvatarUrl, pickAnonymousAvatar } = require('../utils/defaultProfile')
// 评论图片同样过一遍违规地址集合，避免已下线媒体继续展示（P02/P14）
const mediaCheck = require('../services/mediaCheckService')

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch (e) { return null }
}

function parseAnonymousIdentity(identity) {
  const value = parseJson(identity)
  if (!value || !value.nickName || !value.avatarUrl) return null
  const nickName = String(value.nickName).trim().slice(0, 32)
  const raw = String(value.avatarUrl).trim()
  if (raw.indexOf('/assets/avatar1/') !== 0) return null
  // 旧文件名先纠正；纠正后仍不在素材池内的（历史脏数据）稳定映射到池内形象，
  // 否则这条评论的头像会在聊天页/通知列表里一直图裂并刷渲染层错误
  const normalized = normalizeAnonymousAvatarUrl(raw)
  const avatarUrl = isAnonymousAvatarUrl(normalized) ? normalized : pickAnonymousAvatar(nickName || raw)
  return { nickName, avatarUrl }
}

function presentComment(row) {
  const anonymousIdentity = parseAnonymousIdentity(row.anonymous_identity)
  // 评论区头像此前漏了旧路径归一化（/assets/avatar2/1 (39).jpg 已重命名为 avatar_39.jpg），
  // 导致真机上评论者头像渲染为灰色空圆。放在这里是最靠近数据出口的位置，
  // 不依赖 success() 的递归处理，也兼容下划线字段名。
  const rawAvatar = anonymousIdentity ? anonymousIdentity.avatarUrl : row.avatar_url
  return Object.assign({}, row, {
    nick_name: anonymousIdentity ? anonymousIdentity.nickName : row.nick_name,
    avatar_url: normalizeLegacyAvatarUrl(rawAvatar),
    is_anonymous: !!anonymousIdentity,
    images: mediaCheck.filterStoredImages(row.images),
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
      `SELECT c.*, u.nick_name, u.avatar_url, u.allow_anonymous_pm,
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
      const [removed] = await pool.query('DELETE FROM forum_comment_like WHERE comment_id = ? AND user_id = ?', [commentId, req.userId])
      // P22：并发取消点赞时第二次 DELETE 影响 0 行，不能再扣评论点赞数
      if (!removed || removed.affectedRows !== 0) {
        await pool.query('UPDATE forum_comment SET like_count = GREATEST(0, like_count - 1) WHERE id = ?', [commentId])
      }
      success(res, { liked: false })
    } else {
      // 点赞
      // 唯一键 uk_comment_user + INSERT IGNORE 挡住并发重复点赞（P22）
      const [added] = await pool.query('INSERT IGNORE INTO forum_comment_like (comment_id, user_id) VALUES (?, ?)', [commentId, req.userId])
      const likedNow = !added || added.affectedRows !== 0
      if (likedNow) {
        await pool.query('UPDATE forum_comment SET like_count = like_count + 1 WHERE id = ?', [commentId])
      }
      const [comments] = await pool.query('SELECT user_id, post_id, content, images FROM forum_comment WHERE id = ?', [commentId])
      // 并发重复点赞（明细其实已存在）不再补发通知，避免作者收到两条一样的点赞提醒（P22）
      if (likedNow && comments.length && Number(comments[0].user_id) !== Number(req.userId)) {
        const [actors] = await pool.query('SELECT id, nick_name, avatar_url FROM sys_user WHERE id = ?', [req.userId])
        const actor = actors.length ? { id: actors[0].id, nickName: actors[0].nick_name, avatarUrl: actors[0].avatar_url } : null
        const [posts] = await pool.query('SELECT title FROM forum_post WHERE id = ?', [comments[0].post_id])
        createNotification({
          userId: comments[0].user_id,
          type: 'like',
          title: '你的评论收到了点赞',
          content: withMediaPlaceholder(String(comments[0].content || '').slice(0, 200), parseJson(comments[0].images)),
          relatedId: comments[0].post_id,
          // 锚点：点这条消息进原帖时直接定位并高亮「被点赞的那条评论」。
          // 缺失时用户只能在评论区里手动翻，等于「定不了位」。
          sourceCommentId: commentId,
          actorUserId: actor ? actor.id : null,
          actorNick: actor ? actor.nickName : '',
          actorAvatar: actor ? actor.avatarUrl : '',
          postTitle: posts.length ? (posts[0].title || '') : ''
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
    if (anonymousIdentity && !normalizedAnonymousIdentity) return fail(res, '分身身份格式不正确')
    const [posts] = await pool.query('SELECT id, user_id, title FROM forum_post WHERE id = ? AND status = 1', [postId])
    if (!posts.length) return fail(res, '帖子不存在', 404)
    // 同一评论区身份一致性：该用户在此帖子下已有匿名评论时，一律复用首次存档的分身身份，
    // 不再采用客户端本次随机生成的身份，避免同一评论区每条评论头像昵称各不相同
    let effectiveIdentity = normalizedAnonymousIdentity
    if (effectiveIdentity) {
      const [archived] = await pool.query(
        `SELECT anonymous_identity FROM forum_comment
         WHERE post_id = ? AND user_id = ? AND anonymous_identity IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
        [postId, req.userId]
      )
      const existingIdentity = archived.length ? parseAnonymousIdentity(archived[0].anonymous_identity) : null
      if (existingIdentity) effectiveIdentity = existingIdentity
    }
    const imagesJson = Array.isArray(images) ? JSON.stringify(images) : null
    const [result] = await pool.query(
      'INSERT INTO forum_comment (post_id, user_id, content, images, anonymous_identity, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
      [postId, req.userId, content.trim(), imagesJson, effectiveIdentity ? JSON.stringify(effectiveIdentity) : null, parentId || 0]
    )
    await pool.query('UPDATE forum_post SET comment_count = comment_count + 1 WHERE id = ?', [postId])
    // 通知快照：匿名评论用匿名形象，否则用评论者真实资料
    let actor = effectiveIdentity
      ? { id: null, nickName: effectiveIdentity.nickName, avatarUrl: effectiveIdentity.avatarUrl }
      : null
    if (!actor) {
      const [actors] = await pool.query('SELECT id, nick_name, avatar_url FROM sys_user WHERE id = ?', [req.userId])
      actor = actors.length ? { id: actors[0].id, nickName: actors[0].nick_name, avatarUrl: actors[0].avatar_url } : null
    }
    const actorSnapshot = {
      actorUserId: actor ? actor.id : null,
      actorNick: actor ? actor.nickName : '',
      actorAvatar: actor ? actor.avatarUrl : '',
    }
    const commentContent = withMediaPlaceholder(content.trim().slice(0, 200), images)
    const postTitle = posts[0].title || ''
    const postAuthorId = Number(posts[0].user_id)
    const commenterId = Number(req.userId)
    // 先解析父评论作者，后续据此区分「帖子评论」和「回复评论」通知。
    // 回复帖子作者自己的评论时，应优先发送 reply 通知，避免被误归类为 comment。
    const parentCommentId = Number(parentId) || 0
    let parentAuthorId = 0
    if (parentCommentId > 0) {
      const [parentRows] = await pool.query(
        'SELECT user_id FROM forum_comment WHERE id = ? AND status = 1 LIMIT 1',
        [parentCommentId]
      )
      parentAuthorId = parentRows.length ? Number(parentRows[0].user_id) : 0
    }
    // 1) 帖子作者：你的帖子有新评论
    // 如果父评论就是帖子作者本人，则由下方 reply 通知覆盖，避免同一事件显示为「评论了你的帖子」。
    if (postAuthorId !== commenterId && !(parentAuthorId && parentAuthorId === postAuthorId)) {
      createNotification(Object.assign({
        userId: postAuthorId,
        type: 'comment',
        title: '你的帖子有新评论',
        content: commentContent,
        relatedId: postId,
        // 锚点：点这条消息进原帖时定位并高亮「就是这条评论」，配色也按它取（两边同色）
        sourceCommentId: result.insertId,
        postTitle,
        commentImages: Array.isArray(images) ? images : []
      }, actorSnapshot)).catch(() => {})
    }
    // 2) 蹲贴者：你蹲的帖子有新评论。
    //    此前只通知帖子作者，蹲过该帖的用户收不到任何消息（消息列表永远为空）——
    //    这是「其他用户评论了用户蹲过的帖子时消息未显示」的根因。
    //    排除评论者本人与帖子作者（作者已在上面收到一条，避免同一评论重复通知作者）。
    const [followRows] = await pool.query('SELECT user_id FROM forum_post_follow WHERE post_id = ?', [postId])
    const followTargets = []
    followRows.forEach((row) => {
      const targetId = Number(row.user_id)
      if (!targetId || targetId === commenterId || targetId === postAuthorId || targetId === parentAuthorId) return
      if (followTargets.indexOf(targetId) === -1) followTargets.push(targetId)
    })
    followTargets.forEach((targetId) => {
      createNotification(Object.assign({
        userId: targetId,
        // 独立类型：前端归入「评论」tab，但标题区分「你蹲的帖子」，避免用户误以为是自己发布的帖子被评论
        type: 'follow',
        title: '你蹲的帖子有新评论',
        content: commentContent,
        relatedId: postId,
        // 与作者那条同源：同一条评论 fan-out 给多个蹲贴者，靠唯一键含 user_id 才不会被吞
        sourceCommentId: result.insertId,
        postTitle,
        commentImages: Array.isArray(images) ? images : []
      }, actorSnapshot)).catch(() => {})
    })
    // 3) 被回复的评论作者：有人回复了你的评论。
    // 即使被回复人同时是帖子作者，也必须保留 reply 类型，前端才能正确展示文案并使用回复订阅模板。
    if (parentAuthorId && parentAuthorId !== commenterId) {
      createNotification(Object.assign({
        userId: parentAuthorId,
        type: 'reply',
        sourceCommentId: result.insertId,
        title: '有人回复了你的评论',
        content: commentContent,
        relatedId: postId,
        postTitle,
        commentImages: Array.isArray(images) ? images : []
      }, actorSnapshot)).catch(() => {})
    }
    // 返回实际生效的匿名身份：客户端乐观上屏时用它纠偏，保证显示与服务端存档一致
    success(res, { id: result.insertId, anonymousIdentity: effectiveIdentity })
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

// 删除评论。三种身份可以删：
//   1) 管理员（content.manage）—— 任意帖子下的任意评论；
//   2) 帖子作者 —— 自己评论区里的任意评论（含他人发的），但不能删别人帖子下的评论；
//   3) 评论作者 —— 自己发的评论。
// 连带删除所有下级回复，并同步 forum_post.comment_count。
// 旧实现只认「评论作者」，因此帖子作者在自己评论区里删别人的评论会命中 0 行返回 403。
exports.remove = async (req, res) => {
  const commentId = parseInt(req.params.id, 10)
  if (!commentId) return fail(res, '评论不存在', 404)
  const isAdmin = !!(req.user && hasPermission(req.user.role, 'content.manage'))
  try {
    // 一并取出帖子作者：判「是否本帖作者」必须和评论同一次查询拿到，避免两次查询之间评论被删
    const [rows] = await pool.query(
      `SELECT c.id, c.post_id, c.user_id, p.user_id AS post_author_id
       FROM forum_comment c LEFT JOIN forum_post p ON p.id = c.post_id
       WHERE c.id = ? AND c.status = 1`,
      [commentId],
    )
    if (!rows.length) return fail(res, '评论不存在', 404)
    const comment = rows[0]
    const isCommentOwner = Number(comment.user_id) === Number(req.userId)
    const isPostAuthor = Number(comment.post_author_id) === Number(req.userId)
    if (!isAdmin && !isCommentOwner && !isPostAuthor) return fail(res, '无权删除', 403)

    // 逐层收集后代回复：数据里存在二级及更深的回复，只查一层会留下孤儿
    const ids = [commentId]
    let frontier = [commentId]
    while (frontier.length) {
      const [children] = await pool.query(
        `SELECT id FROM forum_comment WHERE parent_id IN (${frontier.map(() => '?').join(', ')}) AND status = 1`,
        frontier,
      )
      if (!children.length) break
      frontier = children.map((item) => item.id)
      ids.push(...frontier)
    }
    const [result] = await pool.query(
      `UPDATE forum_comment SET status = 0 WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 1`,
      ids,
    )
    if (result.affectedRows) {
      await pool.query(
        'UPDATE forum_post SET comment_count = GREATEST(comment_count - ?, 0) WHERE id = ?',
        [result.affectedRows, comment.post_id],
      )
    }
    success(res, { removed: result.affectedRows, asPostAuthor: isPostAuthor && !isAdmin })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
