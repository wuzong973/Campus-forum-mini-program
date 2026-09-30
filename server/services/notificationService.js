const pool = require('../config/pool')
const wsServer = require('../ws/wsServer')
const subscribeService = require('./subscribeService')

// 评论/点赞带媒体时，通知内容追加媒体占位符（评论当前仅支持图片，扩展名兜底识别视频）
function withMediaPlaceholder(content, images) {
  const list = Array.isArray(images) ? images : []
  if (!list.length) return content
  const hasVideo = list.some((url) => /\.(mp4|mov|m4v|avi|mkv|webm)(\?|$)/i.test(String(url)))
  return `${content}${content ? ' ' : ''}[${hasVideo ? '视频' : '图片'}]`
}

async function createNotification({ userId, type, title, content = '', relatedId = '', sourceCommentId = null, actorUserId = null, actorNick = '', actorAvatar = '', postTitle = '', commentImages = null }) {
  if (!userId) return null
  const imagesJson = Array.isArray(commentImages) && commentImages.length ? JSON.stringify(commentImages) : null
  const [result] = await pool.query(
    'INSERT INTO system_notification (user_id, type, title, content, related_id, source_comment_id, actor_user_id, actor_nick, actor_avatar, post_title, comment_images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [userId, type, title, content, String(relatedId), sourceCommentId ? Number(sourceCommentId) : null, actorUserId, actorNick, actorAvatar, postTitle, imagesJson]
  ).catch((error) => {
    // P20：同一来源评论的回复通知有唯一键 uk_notification_source_comment，
    // 并发重复插入（同一评论被两次触发通知）在这里静默收敛，不影响评论主流程
    if (error && error.code === 'ER_DUP_ENTRY') return null
    throw error
  })
  if (!result) return null
  const notification = {
    id: result.insertId,
    userId,
    type,
    title,
    content,
    relatedId: String(relatedId),
    sourceCommentId: sourceCommentId ? Number(sourceCommentId) : null,
    actorUserId,
    actorNick,
    actorAvatar,
    postTitle,
    commentImages: Array.isArray(commentImages) ? commentImages : [],
    isRead: false,
    createdAt: new Date().toISOString()
  }
  wsServer.sendToUser(userId, { type: 'notification', data: notification })
  // 互动类通知额外下发订阅消息（未配置模板/额度不足时静默降级）
  pushCommentSubscribe(notification)
  return notification
}

// 通知类型 → 订阅消息互动文案
const INTERACT_TEXT = {
  comment: '评论了你的帖子',
  follow: '评论了你蹲的帖子',
  reply: '回复了你的评论',
  like: '给你点了赞',
  errand: '跑腿订单有新动态',
  repair: '维修订单有新动态',
  system: '收到一条系统消息'
}

function pushCommentSubscribe(notification) {
  // 仅评论/蹲贴/评论回复有对应授权模板（发帖弹窗引导授权）；点赞无专属模板且高频，只留站内信。
  if (!['comment', 'follow', 'reply'].includes(notification.type)) return
  if (notification.type === 'reply') {
    subscribeService.pushCommentReply(notification.userId, {
      postDigest: notification.postTitle,
      actorNick: notification.actorNick,
      commentDigest: notification.content,
      postId: notification.relatedId
    }).catch(() => {})
    return
  }
  subscribeService.pushComment(notification.userId, {
    channelText: '校园论坛',
    postDigest: notification.postTitle,
    commentDigest: notification.content,
    postId: notification.relatedId
  }).catch(() => {})
}

module.exports = { createNotification, withMediaPlaceholder }
