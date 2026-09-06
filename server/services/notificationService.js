const pool = require('../config/pool')
const wsServer = require('../ws/wsServer')

// 评论/点赞带媒体时，通知内容追加媒体占位符（评论当前仅支持图片，扩展名兜底识别视频）
function withMediaPlaceholder(content, images) {
  const list = Array.isArray(images) ? images : []
  if (!list.length) return content
  const hasVideo = list.some((url) => /\.(mp4|mov|m4v|avi|mkv|webm)(\?|$)/i.test(String(url)))
  return `${content}${content ? ' ' : ''}[${hasVideo ? '视频' : '图片'}]`
}

async function createNotification({ userId, type, title, content = '', relatedId = '', actorUserId = null, actorNick = '', actorAvatar = '', postTitle = '', commentImages = null }) {
  if (!userId) return null
  const imagesJson = Array.isArray(commentImages) && commentImages.length ? JSON.stringify(commentImages) : null
  const [result] = await pool.query(
    'INSERT INTO system_notification (user_id, type, title, content, related_id, actor_user_id, actor_nick, actor_avatar, post_title, comment_images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, type, title, content, String(relatedId), actorUserId, actorNick, actorAvatar, postTitle, imagesJson]
  )
  const notification = {
    id: result.insertId,
    userId,
    type,
    title,
    content,
    relatedId: String(relatedId),
    actorUserId,
    actorNick,
    actorAvatar,
    postTitle,
    commentImages: Array.isArray(commentImages) ? commentImages : [],
    isRead: false,
    createdAt: new Date().toISOString()
  }
  wsServer.sendToUser(userId, { type: 'notification', data: notification })
  return notification
}

module.exports = { createNotification, withMediaPlaceholder }
