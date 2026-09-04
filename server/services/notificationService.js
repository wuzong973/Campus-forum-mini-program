const pool = require('../config/pool')
const wsServer = require('../ws/wsServer')

async function createNotification({ userId, type, title, content = '', relatedId = '' }) {
  if (!userId) return null
  const [result] = await pool.query(
    'INSERT INTO system_notification (user_id, type, title, content, related_id) VALUES (?, ?, ?, ?, ?)',
    [userId, type, title, content, String(relatedId)]
  )
  const notification = {
    id: result.insertId,
    userId,
    type,
    title,
    content,
    relatedId: String(relatedId),
    isRead: false,
    createdAt: new Date().toISOString()
  }
  wsServer.sendToUser(userId, { type: 'notification', data: notification })
  return notification
}

module.exports = { createNotification }
