const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const wsServer = require('../ws/wsServer')

async function getOrCreateConversation(userId, peerId, anonymousRequested = false) {
  if (userId === peerId) throw new Error('不能给自己发私信')
  const [users] = await pool.query('SELECT id, nick_name, avatar_url FROM sys_user WHERE id = ? AND status = 1', [peerId])
  if (!users.length) throw new Error('用户不存在')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [mine] = await conn.query('SELECT id, is_anonymous FROM private_conversation WHERE user_id = ? AND peer_id = ? FOR UPDATE', [userId, peerId])
    let myConvId = mine[0] && mine[0].id
    let peerConvId
    if (!myConvId) {
      const [result] = await conn.query('INSERT INTO private_conversation (user_id, peer_id, is_anonymous) VALUES (?, ?, ?)', [userId, peerId, anonymousRequested ? 1 : 0])
      myConvId = result.insertId
    }
    const [peer] = await conn.query('SELECT id FROM private_conversation WHERE user_id = ? AND peer_id = ? FOR UPDATE', [peerId, userId])
    if (peer.length) peerConvId = peer[0].id
    else {
      const [result] = await conn.query('INSERT INTO private_conversation (user_id, peer_id, is_anonymous) VALUES (?, ?, ?)', [peerId, userId, anonymousRequested ? 1 : 0])
      peerConvId = result.insertId
    }
    if (anonymousRequested) await conn.query('UPDATE private_conversation SET is_anonymous = 1 WHERE id IN (?, ?)', [myConvId, peerConvId])
    const [state] = await conn.query('SELECT is_anonymous FROM private_conversation WHERE id = ?', [myConvId])
    await conn.commit()
    return { myConvId, peerConvId, peerInfo: users[0], isAnonymous: !!(state[0] && state[0].is_anonymous) }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function getPendingMessage(userId, peerId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id FROM private_message
     WHERE sender_id = ? AND receiver_id = ? AND status != 'recalled'
       AND id > IFNULL((SELECT MAX(id) FROM private_message WHERE sender_id = ? AND receiver_id = ? AND status != 'recalled'), 0)
     ORDER BY id DESC LIMIT 1`,
    [userId, peerId, peerId, userId]
  )
  return rows[0] || null
}

async function updateConversationPreview(conn, userId, peerId) {
  const [latest] = await conn.query(
    `SELECT id, content, msg_type, created_at FROM private_message
     WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND status != 'recalled'
     ORDER BY id DESC LIMIT 1`,
    [userId, peerId, peerId, userId]
  )
  const message = latest[0]
  const text = message ? (message.msg_type === 'image' ? '[图片]' : message.content.slice(0, 500)) : ''
  const time = message ? message.created_at : null
  await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = ? WHERE (user_id = ? AND peer_id = ?) OR (user_id = ? AND peer_id = ?)', [message ? message.id : null, text, time, userId, peerId, peerId, userId])
}

async function isBlocked(userId, targetId) {
  if (!userId || !targetId || Number(userId) === Number(targetId)) return false
  const [rows] = await pool.query('SELECT id FROM user_blacklist WHERE user_id = ? AND blocked_id = ? LIMIT 1', [userId, targetId])
  return rows.length > 0
}

async function createPrivateMessage(senderId, receiverId, content, msgType = 'text', anonymousRequested = false) {
  // 拉黑双向拦截：接收方拉黑发送方时拒绝投递，发送方拉黑接收方时提示先解除
  if (await isBlocked(receiverId, senderId)) throw new Error('消息发送失败，对方已将你加入黑名单')
  if (await isBlocked(senderId, receiverId)) throw new Error('你已拉黑对方，请先解除拉黑后再发送')
  const conversation = await getOrCreateConversation(senderId, receiverId, anonymousRequested)
  const text = String(content).trim()
  const type = ['text', 'image', 'emoji'].includes(msgType) ? msgType : 'text'
  if (conversation.isAnonymous && type !== 'text') throw new Error('匿名聊天仅支持发送文字')
  const conn = await pool.getConnection()
  let messageId
  try {
    await conn.beginTransaction()
    // Lock the sender's conversation row so concurrent requests cannot bypass the one-message rule.
    await conn.query('SELECT id FROM private_conversation WHERE id = ? FOR UPDATE', [conversation.myConvId])
    if (await getPendingMessage(senderId, receiverId, conn)) throw new Error('请等待对方回复后再发送；可长按上一条消息撤回')
    const [result] = await conn.query('INSERT INTO private_message (conversation_id, sender_id, receiver_id, content, msg_type) VALUES (?, ?, ?, ?, ?)', [conversation.myConvId, senderId, receiverId, text, type])
    messageId = result.insertId
    await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW() WHERE id = ?', [messageId, type === 'image' ? '[图片]' : text.slice(0, 500), conversation.myConvId])
    await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW(), unread_count = unread_count + 1 WHERE id = ?', [messageId, type === 'image' ? '[图片]' : text.slice(0, 500), conversation.peerConvId])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  const data = { id: messageId, senderId, receiverId, content: text, msgType: type, createdAt: new Date().toISOString(), status: 'sent', isAnonymous: conversation.isAnonymous }
  wsServer.sendToUser(receiverId, { type: 'private_message', data })
  return data
}

exports.send = async (req, res) => {
  const receiverId = parseInt(req.body.receiverId, 10)
  const { content, msgType } = req.body
  if (typeof content === 'string' && content.trim().length > 1000) return fail(res, '消息不能超过1000个字符')
  if (!receiverId || !content || !content.trim()) return fail(res, '参数不完整')
  try {
    const message = await createPrivateMessage(req.userId, receiverId, content, msgType, !!req.body.anonymous)
    success(res, { id: message.id, status: message.status, createdAt: message.createdAt, isAnonymous: message.isAnonymous })
  } catch (e) { fail(res, safeMessage(e), 400) }
}

exports.createPrivateMessage = createPrivateMessage

exports.history = async (req, res) => {
  const peerId = parseInt(req.query.peerId, 10)
  const page = parseInt(req.query.page, 10) || 1
  const pageSize = clampPageSize(req.query.pageSize, 50)
  const offset = (page - 1) * pageSize
  if (!peerId) return fail(res, '缺少peerId')
  try {
    const conversation = await getOrCreateConversation(req.userId, peerId, req.query.anonymous === '1')
    const params = [req.userId, peerId, peerId, req.userId]
    const [countRows] = await pool.query("SELECT COUNT(*) AS total FROM private_message WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND status != 'recalled'", params)
    const [rows] = await pool.query(
      `SELECT m.*, u.nick_name AS sender_nick, u.avatar_url AS sender_avatar FROM private_message m
       LEFT JOIN sys_user u ON m.sender_id = u.id
       WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)) AND m.status != 'recalled'
       ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      params.concat([pageSize, offset])
    )
    const total = countRows[0].total
    const pending = await getPendingMessage(req.userId, peerId)
    const [blocked, blockedByPeer] = await Promise.all([isBlocked(req.userId, peerId), isBlocked(peerId, req.userId)])
    const list = rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, receiverId: r.receiver_id, content: r.content, msgType: r.msg_type, status: r.status, senderNick: r.sender_nick, senderAvatar: r.sender_avatar, createdAt: r.created_at }))
    success(res, { list: list.reverse(), total, hasMore: offset + pageSize < total, canSend: !pending && !blocked && !blockedByPeer, pendingMessageId: pending ? pending.id : 0, isAnonymous: conversation.isAnonymous, blocked, blockedByPeer })
  } catch (e) { fail(res, safeMessage(e), 400) }
}

exports.recall = async (req, res) => {
  const messageId = Number(req.params.id)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT id, sender_id, receiver_id, status FROM private_message WHERE id = ? FOR UPDATE', [messageId])
    const message = rows[0]
    if (!message || Number(message.sender_id) !== Number(req.userId) || message.status === 'recalled') throw new Error('消息无法撤回')
    const [replies] = await conn.query("SELECT id FROM private_message WHERE sender_id = ? AND receiver_id = ? AND status != 'recalled' AND id > ? LIMIT 1", [message.receiver_id, message.sender_id, message.id])
    if (replies.length) throw new Error('对方已回复，无法撤回')
    await conn.query("UPDATE private_message SET status = 'recalled' WHERE id = ?", [messageId])
    await conn.query('INSERT INTO private_message_recall_log (message_id, operator_id, receiver_id) VALUES (?, ?, ?)', [messageId, req.userId, message.receiver_id])
    await updateConversationPreview(conn, message.sender_id, message.receiver_id)
    await conn.commit()
    wsServer.sendToUser(message.receiver_id, { type: 'private_message_recalled', data: { id: messageId, peerId: req.userId } })
    success(res, null)
  } catch (e) { await conn.rollback(); fail(res, safeMessage(e), 400) } finally { conn.release() }
}

exports.conversations = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT c.id, c.peer_id, c.unread_count, c.last_message_text, c.last_message_time, c.is_anonymous, u.nick_name AS peer_nick, u.avatar_url AS peer_avatar FROM private_conversation c LEFT JOIN sys_user u ON c.peer_id = u.id WHERE c.user_id = ? AND c.status = 1 ORDER BY c.last_message_time DESC`, [req.userId])
    success(res, { list: rows.map((r) => ({ id: r.id, peerId: r.peer_id, peerNick: r.is_anonymous ? '匿名用户' : r.peer_nick, peerAvatar: r.is_anonymous ? '/assets/icons/avatar.png' : r.peer_avatar, unreadCount: r.unread_count, lastMessage: r.last_message_text, lastTime: r.last_message_time, isAnonymous: !!r.is_anonymous })) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.markRead = async (req, res) => {
  const peerId = parseInt(req.body.peerId, 10)
  if (!peerId) return fail(res, '缺少peerId')
  try {
    await getOrCreateConversation(req.userId, peerId)
    await pool.query('UPDATE private_conversation SET unread_count = 0 WHERE user_id = ? AND peer_id = ?', [req.userId, peerId])
    await pool.query("UPDATE private_message SET status = 'read' WHERE sender_id = ? AND receiver_id = ? AND status NOT IN ('read', 'recalled')", [peerId, req.userId])
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 400) }
}

exports.unreadCount = async (req, res) => {
  try { const [rows] = await pool.query('SELECT IFNULL(SUM(unread_count), 0) AS total FROM private_conversation WHERE user_id = ? AND status = 1', [req.userId]); success(res, { total: rows[0].total }) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateStatus = async (req, res) => {
  const { messageId, status } = req.body
  if (!messageId || !status || status === 'recalled') return fail(res, '参数不完整')
  try { await pool.query("UPDATE private_message SET status = ? WHERE id = ? AND (sender_id = ? OR receiver_id = ?) AND status != 'recalled'", [status, messageId, req.userId, req.userId]); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.block = async (req, res) => {
  const peerId = parseInt(req.body.peerId, 10)
  if (!peerId) return fail(res, '缺少peerId')
  if (peerId === req.userId) return fail(res, '不能拉黑自己')
  try {
    const [users] = await pool.query('SELECT id FROM sys_user WHERE id = ? AND status = 1', [peerId])
    if (!users.length) return fail(res, '用户不存在')
    await pool.query('INSERT IGNORE INTO user_blacklist (user_id, blocked_id) VALUES (?, ?)', [req.userId, peerId])
    success(res, { blocked: true })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.unblock = async (req, res) => {
  const peerId = parseInt(req.body.peerId, 10)
  if (!peerId) return fail(res, '缺少peerId')
  try {
    await pool.query('DELETE FROM user_blacklist WHERE user_id = ? AND blocked_id = ?', [req.userId, peerId])
    success(res, { blocked: false })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.blacklist = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.blocked_id AS userId, u.nick_name AS nick, u.avatar_url AS avatar, b.created_at FROM user_blacklist b
       LEFT JOIN sys_user u ON b.blocked_id = u.id WHERE b.user_id = ? ORDER BY b.created_at DESC`, [req.userId])
    success(res, { list: rows.map((r) => ({ userId: r.userId, nick: r.nick, avatar: r.avatar, createdAt: r.created_at })) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}
