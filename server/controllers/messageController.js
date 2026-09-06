const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const wsServer = require('../ws/wsServer')

// 分身匿名身份与帖子同一套结构（{nickName, avatarUrl}）；头像必须是内置素材路径，防止任意外链
function parseAnonymousIdentity(identity) {
  let value = identity
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch (e) { return null }
  }
  if (!value || !value.nickName || !value.avatarUrl) return null
  const avatarUrl = String(value.avatarUrl).trim()
  if (!avatarUrl.startsWith('/assets/avatar1/')) return null
  return { nickName: String(value.nickName).trim().slice(0, 32), avatarUrl }
}

// 服务端随机分身池（与客户端 utils/anonymousIdentity.js 同源）：匿名私信发送方无档案时自动生成，保证收信方会话列表/聊天页显示统一的匿名昵称头像
const ANON_AVATARS = [
  '/assets/avatar1/鹰.jpg', '/assets/avatar1/鳄鱼.jpg', '/assets/avatar1/鲸鱼.jpg', '/assets/avatar1/骆驼.jpg',
  '/assets/avatar1/青蛙.jpg', '/assets/avatar1/长颈鹿.jpg', '/assets/avatar1/袋鼠.jpg', '/assets/avatar1/蟾蜍.jpg',
  '/assets/avatar1/蝴蝶.jpg', '/assets/avatar1/蜜蜂.jpg', '/assets/avatar1/蛇.jpg', '/assets/avatar1/考拉.jpg',
  '/assets/avatar1/考拉 (2).jpg', '/assets/avatar1/老虎.jpg', '/assets/avatar1/老虎 (2).jpg', '/assets/avatar1/羊驼.jpg',
  '/assets/avatar1/猴子.jpg', '/assets/avatar1/猫头鹰.jpg', '/assets/avatar1/狼.jpg', '/assets/avatar1/狮子.jpg',
  '/assets/avatar1/狐狸.jpg', '/assets/avatar1/犀牛.jpg', '/assets/avatar1/熊猫.jpg', '/assets/avatar1/海豹.jpg',
  '/assets/avatar1/海狮.jpg', '/assets/avatar1/河马.jpg', '/assets/avatar1/松鼠.jpg', '/assets/avatar1/斑马.jpg',
  '/assets/avatar1/孔雀.jpg', '/assets/avatar1/大象.jpg', '/assets/avatar1/土拨鼠.jpg', '/assets/avatar1/喜鹊.jpg',
  '/assets/avatar1/北极熊.jpg', '/assets/avatar1/刺猬.jpg', '/assets/avatar1/八哥.jpg', '/assets/avatar1/兔子.jpg',
  '/assets/avatar1/乌龟.jpg', '/assets/avatar1/七星瓢虫.jpg'
]
const ANON_NAMES = [
  '蜿蜒的小溪', '平静的湖面', '汹涌的海浪', '清澈的泉水', '浑浊的黄河',
  '冰封的河面', '退潮的沙滩', '涨水的池塘', '干涸的河床', '冒泡的温泉',
  '深幽的碧潭', '初升的朝阳', '西沉的落日', '皎洁的明月', '闪烁的繁星',
  '划过的流星', '朦胧的月晕', '刺眼的烈日', '温柔的月光', '密集的星群',
  '孤独的晨星', '残缺的月牙', '圆满的满月', '暗淡的星光', '燃烧的太阳',
  '沉睡的夜空', '璀璨的银河', '神秘的星云', '旋转的北斗', '火红的晚霞',
  '呼啸的狂风', '轻柔的微风', '漂泊的白云', '阴沉的乌云', '淅沥的小雨',
  '倾盆的暴雨', '纷飞的大雪', '细碎的雪花', '轰隆的雷声', '划破的闪电',
  '弥漫的大雾', '凝结的白霜', '冰冷的冰雹', '潮湿的露水', '旋转的龙卷',
  '刺骨的寒风', '和煦的春风', '闷热的夏风', '凉爽的秋风', '凛冽的冬风',
  '茂密的森林', '稀疏的树林', '高大的松柏', '低矮的灌木', '翠绿的草地',
  '枯黄的落叶', '挺拔的白杨', '婆娑的柳树', '盘根的老树', '新生的嫩芽',
  '盛开的野花', '凋零的花瓣', '缠绕的藤蔓', '带刺的荆棘', '漂浮的浮萍',
  '摇曳的芦苇', '苍劲的古松', '翠绿的青竹', '火红的枫叶', '金黄的银杏',
  '回暖的初春', '酷热的盛夏', '凉爽的深秋', '严寒的隆冬', '破晓的黎明',
  '金色的黄昏', '寂静的深夜', '微凉的清晨', '多雨的梅季', '干燥的秋季',
  '多风的早春', '短昼的冬至', '长夜的夏至', '飞流的瀑布', '水帘的后面',
  '深幽的洞穴', '轰鸣的水潭', '溅起的水花', '彩虹的水雾', '攀爬的苔藓',
  '栖息的蝙蝠', '滴水的岩壁', '回声的空洞', '透光的石缝', '黄昏的海边',
  '初雪的街口', '樱花的坡道', '雨夜的屋檐', '晚霞的天台', '星空的山顶',
  '晨光的窗台', '落叶的小径', '薄雾的渡口', '萤火的夏夜', '月光的小巷',
  '春风的巷口', '落日的码头', '雨后的彩虹', '雪夜的路灯', '花田的尽头',
  '海风的街角', '秋叶的长椅', '春水的桥头', '冬阳的窗边', '清晨的森林',
  '午后的茶园', '傍晚的湖面', '深夜的山谷', '雨后的竹林', '雪后的村庄',
  '春日的田野', '夏日的荷塘', '秋日的果园', '冬日的壁炉', '雾中的远山',
  '风中的芦苇', '云中的山峰', '水中的倒影', '光中的尘埃', '影中的老树',
  '声中的溪流', '色中的晚霞', '味中的炊烟', '触中的微风'
]

function generateAnonIdentity() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)]
  return { nickName: pick(ANON_NAMES), avatarUrl: pick(ANON_AVATARS) }
}

async function getOrCreateConversation(userId, peerId, anonymousRequested = false, anonymousIdentity = null, anonSide = 'peer') {
  if (userId === peerId) throw new Error('不能给自己发私信')
  const [users] = await pool.query('SELECT id, nick_name, avatar_url, allow_anonymous_pm FROM sys_user WHERE id = ? AND status = 1', [peerId])
  if (!users.length) throw new Error('用户不存在')
  // 对方关闭“允许被匿名私信”后，禁止以匿名身份建立会话
  if (anonymousRequested && Number(users[0].allow_anonymous_pm) === 0) throw new Error('对方不允许匿名私信')
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
    // 首次以匿名方式进入时存档分身身份（只存一次，之后不再覆盖，保证全程同一个匿名头像）
    // anonSide=peer：分身属于对方（分身卡片私信）；anonSide=self：分身属于发起方自己（分身私信普通用户）
    const identity = anonymousRequested ? parseAnonymousIdentity(anonymousIdentity) : null
    if (identity) {
      const payload = JSON.stringify(identity)
      if (anonSide === 'self') {
        await conn.query('UPDATE private_conversation SET anon_self_identity = ? WHERE id = ? AND anon_self_identity IS NULL', [payload, myConvId])
        await conn.query('UPDATE private_conversation SET anon_peer_identity = ? WHERE id = ? AND anon_peer_identity IS NULL', [payload, peerConvId])
      } else {
        await conn.query('UPDATE private_conversation SET anon_peer_identity = ? WHERE id = ? AND anon_peer_identity IS NULL', [payload, myConvId])
        await conn.query('UPDATE private_conversation SET anon_self_identity = ? WHERE id = ? AND anon_self_identity IS NULL', [payload, peerConvId])
      }
    }
    const [state] = await conn.query('SELECT is_anonymous, anon_peer_identity, anon_self_identity FROM private_conversation WHERE id = ?', [myConvId])
    await conn.commit()
    return {
      myConvId,
      peerConvId,
      peerInfo: users[0],
      isAnonymous: !!(state[0] && state[0].is_anonymous),
      peerAnonymous: state[0] ? parseAnonymousIdentity(state[0].anon_peer_identity) : null,
      selfAnonymous: state[0] ? parseAnonymousIdentity(state[0].anon_self_identity) : null
    }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function getPendingMessage(userId, peerId, conn = pool) {
  // The one-message waiting rule only applies before the other participant has
  // ever replied. Once both sides have sent a message, this conversation is open.
  const [replies] = await conn.query(
    `SELECT id FROM private_message
     WHERE sender_id = ? AND receiver_id = ? AND status != 'recalled'
     LIMIT 1`,
    [peerId, userId]
  )
  if (replies.length) return null

  const [rows] = await conn.query(
    `SELECT id FROM private_message
     WHERE sender_id = ? AND receiver_id = ? AND status != 'recalled'
     ORDER BY id DESC LIMIT 1`,
    [userId, peerId]
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

async function createPrivateMessage(senderId, receiverId, content, msgType = 'text', anonymousRequested = false, anonymousIdentity = null) {
  // 拉黑双向拦截：接收方拉黑发送方时拒绝投递，发送方拉黑接收方时提示先解除
  if (await isBlocked(receiverId, senderId)) throw new Error('消息发送失败，对方已将你加入黑名单')
  if (await isBlocked(senderId, receiverId)) throw new Error('你已拉黑对方，请先解除拉黑后再发送')
  // 匿名发送方身份：优先用客户端上传的分身形象，否则服务端生成随机分身并存档，
  // 保证收信方会话列表与聊天页显示统一的匿名昵称头像（存档只写一次，之后不覆盖）
  const identity = anonymousRequested
    ? (parseAnonymousIdentity(anonymousIdentity) || generateAnonIdentity())
    : null
  const conversation = await getOrCreateConversation(senderId, receiverId, anonymousRequested, identity, 'self')
  const text = String(content).trim()
  const type = ['text', 'image', 'emoji', 'video'].includes(msgType) ? msgType : 'text'
  const lastText = type === 'image' ? '[图片]' : type === 'video' ? '[视频]' : text.slice(0, 500)
  const conn = await pool.getConnection()
  let messageId
  try {
    await conn.beginTransaction()
    // Lock the sender's conversation row so concurrent requests cannot bypass the one-message rule.
    await conn.query('SELECT id FROM private_conversation WHERE id = ? FOR UPDATE', [conversation.myConvId])
    if (await getPendingMessage(senderId, receiverId, conn)) throw new Error('请等待对方回复后再发送；可长按上一条消息撤回')
    // 按发送时的匿名请求标记渠道，匿名/普通私信在同一会话内各看各的记录
    const [result] = await conn.query('INSERT INTO private_message (conversation_id, sender_id, receiver_id, content, msg_type, is_anonymous) VALUES (?, ?, ?, ?, ?, ?)', [conversation.myConvId, senderId, receiverId, text, type, anonymousRequested ? 1 : 0])
    messageId = result.insertId
    await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW() WHERE id = ?', [messageId, lastText, conversation.myConvId])
    await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW(), unread_count = unread_count + 1 WHERE id = ?', [messageId, lastText, conversation.peerConvId])
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
    const message = await createPrivateMessage(
      req.userId,
      receiverId,
      content,
      msgType,
      !!req.body.anonymous,
      { nickName: req.body.anonNick, avatarUrl: req.body.anonAvatar }
    )
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
    const anonIdentity = parseAnonymousIdentity({ nickName: req.query.anonNick, avatarUrl: req.query.anonAvatar })
    const anonSide = req.query.anonSide === 'self' ? 'self' : 'peer'
    const conversation = await getOrCreateConversation(req.userId, peerId, req.query.anonymous === '1', anonIdentity, anonSide)
    // 匿名/普通是同一会话里的两条独立记录：显式传了 anonymous 参数按参数选渠道，
    // 未传（旧入口）沿用会话当前的匿名标记
    const channelAnonymous = req.query.anonymous === undefined
      ? !!conversation.isAnonymous
      : req.query.anonymous === '1'
    const params = [req.userId, peerId, peerId, req.userId, channelAnonymous ? 1 : 0]
    const [countRows] = await pool.query("SELECT COUNT(*) AS total FROM private_message WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND status != 'recalled' AND is_anonymous = ?", params)
    const [rows] = await pool.query(
      `SELECT m.*, u.nick_name AS sender_nick, u.avatar_url AS sender_avatar FROM private_message m
       LEFT JOIN sys_user u ON m.sender_id = u.id
       WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)) AND m.status != 'recalled' AND m.is_anonymous = ?
       ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      params.concat([pageSize, offset])
    )
    const total = countRows[0].total
    const pending = await getPendingMessage(req.userId, peerId)
    const [blocked, blockedByPeer] = await Promise.all([isBlocked(req.userId, peerId), isBlocked(peerId, req.userId)])
    const list = rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, receiverId: r.receiver_id, content: r.content, msgType: r.msg_type, status: r.status, senderNick: r.sender_nick, senderAvatar: r.sender_avatar, createdAt: r.created_at }))
    success(res, { list: list.reverse(), total, hasMore: offset + pageSize < total, canSend: !pending && !blocked && !blockedByPeer, pendingMessageId: pending ? pending.id : 0, isAnonymous: conversation.isAnonymous, blocked, blockedByPeer, peerAnonymous: conversation.peerAnonymous, selfAnonymous: conversation.selfAnonymous })
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
    const [rows] = await pool.query(`SELECT c.id, c.peer_id, c.unread_count, c.last_message_text, c.last_message_time, c.is_anonymous, c.anon_peer_identity, u.nick_name AS peer_nick, u.avatar_url AS peer_avatar FROM private_conversation c LEFT JOIN sys_user u ON c.peer_id = u.id WHERE c.user_id = ? AND c.status = 1 ORDER BY c.last_message_time DESC`, [req.userId])
    success(res, { list: rows.map((r) => {
      // 匿名会话已存档过分身身份时，列表也展示分身，保证各入口一致
      const persona = parseAnonymousIdentity(r.anon_peer_identity)
      return { id: r.id, peerId: r.peer_id, peerNick: persona ? persona.nickName : (r.is_anonymous ? '匿名用户' : r.peer_nick), peerAvatar: persona ? persona.avatarUrl : (r.is_anonymous ? '/assets/icons/avatar.png' : r.peer_avatar), unreadCount: r.unread_count, lastMessage: r.last_message_text, lastTime: r.last_message_time, isAnonymous: !!r.is_anonymous }
    }) })
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
