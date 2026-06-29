const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const wsServer = require('../ws/wsServer')

// 获取或创建会话（双向）
async function getOrCreateConversation(userId, peerId) {
  if (userId === peerId) throw new Error('不能给自己发私信')
  // 检查对方是否存在
  const [users] = await pool.query('SELECT id, nick_name, avatar_url FROM sys_user WHERE id = ? AND status = 1', [peerId])
  if (!users.length) throw new Error('用户不存在')

  // 查询当前用户视角的会话
  const [mine] = await pool.query('SELECT id FROM private_conversation WHERE user_id = ? AND peer_id = ?', [userId, peerId])
  let myConvId
  let peerConvId
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    if (mine.length) {
      myConvId = mine[0].id
    } else {
      const [r1] = await conn.query(
        'INSERT INTO private_conversation (user_id, peer_id) VALUES (?, ?)',
        [userId, peerId]
      )
      myConvId = r1.insertId
    }
    const [peer] = await conn.query('SELECT id FROM private_conversation WHERE user_id = ? AND peer_id = ?', [peerId, userId])
    if (peer.length) {
      peerConvId = peer[0].id
    } else {
      const [r2] = await conn.query(
        'INSERT INTO private_conversation (user_id, peer_id) VALUES (?, ?)',
        [peerId, userId]
      )
      peerConvId = r2.insertId
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return { myConvId, peerConvId, peerInfo: users[0] }
}

// 发送私信
exports.send = async (req, res) => {
  const { receiverId, content } = req.body
  if (!receiverId || !content || !content.trim()) return fail(res, '参数不完整')
  try {
    const { myConvId, peerConvId } = await getOrCreateConversation(req.userId, receiverId)
    const text = content.trim()
    const conn = await pool.getConnection()
    let messageId
    try {
      await conn.beginTransaction()
      const [r] = await conn.query(
        'INSERT INTO private_message (conversation_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)',
        [myConvId, req.userId, receiverId, text]
      )
      messageId = r.insertId
      // 更新双方会话最后消息
      await conn.query(
        'UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW() WHERE id = ?',
        [messageId, text.slice(0, 500), myConvId]
      )
      await conn.query(
        'UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW(), unread_count = unread_count + 1 WHERE id = ?',
        [messageId, text.slice(0, 500), peerConvId]
      )
      await conn.commit()
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
    // WebSocket 实时推送
    wsServer.sendToUser(receiverId, {
      type: 'private_message',
      data: {
        id: messageId,
        senderId: req.userId,
        receiverId,
        content: text,
        createdAt: new Date().toISOString(),
        status: 'sent'
      }
    })
    success(res, { id: messageId, status: 'sent' })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 获取与某用户的聊天记录
exports.history = async (req, res) => {
  const peerId = parseInt(req.query.peerId, 10)
  const page = parseInt(req.query.page, 10) || 1
  const pageSize = clampPageSize(req.query.pageSize, 50)
  const offset = (page - 1) * pageSize
  if (!peerId) return fail(res, '缺少peerId')
  try {
    const { myConvId } = await getOrCreateConversation(req.userId, peerId)
    const [countRows] = await pool.query(
      'SELECT COUNT(*) as total FROM private_message WHERE conversation_id = ?',
      [myConvId]
    )
    const [rows] = await pool.query(
      `SELECT m.*, u.nick_name AS sender_nick, u.avatar_url AS sender_avatar
       FROM private_message m
       LEFT JOIN sys_user u ON m.sender_id = u.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [myConvId, pageSize, offset]
    )
    const total = countRows[0].total
    const list = rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      receiverId: r.receiver_id,
      content: r.content,
      msgType: r.msg_type,
      status: r.status,
      senderNick: r.sender_nick,
      senderAvatar: r.sender_avatar,
      createdAt: r.created_at
    }))
    success(res, { list: list.reverse(), total, hasMore: offset + pageSize < total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 获取会话列表
exports.conversations = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.peer_id, c.unread_count, c.last_message_text, c.last_message_time,
        u.nick_name AS peer_nick, u.avatar_url AS peer_avatar
       FROM private_conversation c
       LEFT JOIN sys_user u ON c.peer_id = u.id
       WHERE c.user_id = ? AND c.status = 1
       ORDER BY c.last_message_time DESC`,
      [req.userId]
    )
    const list = rows.map((r) => ({
      id: r.id,
      peerId: r.peer_id,
      peerNick: r.peer_nick,
      peerAvatar: r.peer_avatar,
      unreadCount: r.unread_count,
      lastMessage: r.last_message_text,
      lastTime: r.last_message_time
    }))
    success(res, { list })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 标记会话已读
exports.markRead = async (req, res) => {
  const peerId = parseInt(req.body.peerId, 10)
  if (!peerId) return fail(res, '缺少peerId')
  try {
    const { myConvId } = await getOrCreateConversation(req.userId, peerId)
    await pool.query('UPDATE private_conversation SET unread_count = 0 WHERE user_id = ? AND peer_id = ?', [req.userId, peerId])
    // 更新该会话所有接收方为我且未读的消息状态为已读
    await pool.query(
      'UPDATE private_message SET status = "read" WHERE conversation_id = ? AND receiver_id = ? AND status != "read"',
      [myConvId, req.userId]
    )
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 获取总未读数
exports.unreadCount = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT IFNULL(SUM(unread_count), 0) AS total FROM private_conversation WHERE user_id = ? AND status = 1',
      [req.userId]
    )
    success(res, { total: rows[0].total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 重发失败消息（更新状态）
exports.updateStatus = async (req, res) => {
  const { messageId, status } = req.body
  if (!messageId || !status) return fail(res, '参数不完整')
  try {
    await pool.query(
      'UPDATE private_message SET status = ? WHERE id = ? AND (sender_id = ? OR receiver_id = ?)',
      [status, messageId, req.userId, req.userId]
    )
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
