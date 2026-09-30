const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const wsServer = require('../ws/wsServer')
const subscribeService = require('../services/subscribeService')
// 匿名素材池与归一化：白名单校验必须与「服务端生成分身」用的是同一份列表，
// 否则会出现「发出去的合法形象，自己校验不通过」这类不一致
const {
  ANONYMOUS_AVATARS,
  normalizeLegacyAvatarUrl,
  normalizeAnonymousAvatarUrl,
  isAnonymousAvatarUrl,
  pickAnonymousAvatar,
} = require('../utils/defaultProfile')

// 分身匿名身份与帖子同一套结构（{nickName, avatarUrl}）；头像必须是内置素材路径，防止任意外链
function parseAnonymousIdentity(identity) {
  let value = identity
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch (e) { return null }
  }
  if (!value || !value.nickName || !value.avatarUrl) return null
  const nickName = String(value.nickName).trim().slice(0, 32)
  const raw = String(value.avatarUrl).trim()
  if (raw.indexOf('/assets/avatar1/') !== 0) return null
  // 先纠正旧文件名（「考拉 (2).jpg」→「考拉2.jpg」）；纠正后仍不在素材池内（历史脏数据）
  // 就稳定映射到池内形象：既不渲染根本不存在的图片（渲染层「Failed to load image」），
  // 也绝不回落真实资料 —— 那等于把匿名者直接暴露给被打扰的人
  const normalized = normalizeAnonymousAvatarUrl(raw)
  const avatarUrl = isAnonymousAvatarUrl(normalized) ? normalized : pickAnonymousAvatar(nickName || raw)
  return { nickName, avatarUrl }
}

// 服务端随机分身池（与客户端 utils/anonymousIdentity.js 同源）：匿名私信发送方无档案时自动生成，保证收信方会话列表/聊天页显示统一的匿名昵称头像
// 头像池统一由 utils/defaultProfile.js 维护（含旧文件名纠正），这里不再重复定义。
const ANON_AVATARS = ANONYMOUS_AVATARS
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

// 分身会话隔离键：直接采用分身头像路径（服务端校验过必须来自 /assets/avatar1/，天然唯一）。
// 普通私信固定为 ''。同一真实用户的每个分身各自建立独立会话，聊天记录互不可见
function normalizePersonaKey(personaKey) {
  const value = String(personaKey || '').trim()
  if (!value) return ''
  return value.slice(0, 255)
}

async function getOrCreateConversation(userId, peerId, anonymousRequested = false, anonymousIdentity = null, anonSide = 'peer', personaKey = '', sourcePostId = 0) {
  if (userId === peerId) throw new Error('不能给自己发私信')
  const persona = normalizePersonaKey(personaKey)
  const [users] = await pool.query('SELECT id, nick_name, avatar_url, allow_anonymous_pm FROM sys_user WHERE id = ? AND status = 1', [peerId])
  if (!users.length) throw new Error('用户不存在')
  // 对方关闭“允许被匿名私信”后，仅禁止建立【新】的匿名会话；
  // 已存在的匿名会话（建立时对方仍允许）继续可用，避免开关变更把历史会话变成无法发送的死局。
  // 检查按分身隔离：与分身 A 的既有会话不受影响，但无法用新分身 B 建立新会话
  if (anonymousRequested && Number(users[0].allow_anonymous_pm) === 0) {
    const [existingConv] = await pool.query('SELECT id FROM private_conversation WHERE user_id = ? AND peer_id = ? AND persona_key = ? LIMIT 1', [userId, peerId, persona])
    if (!existingConv.length) throw new Error('对方不允许分身私信')
  }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [mine] = await conn.query('SELECT id, is_anonymous FROM private_conversation WHERE user_id = ? AND peer_id = ? AND persona_key = ? FOR UPDATE', [userId, peerId, persona])
    let myConvId = mine[0] && mine[0].id
    let peerConvId
    if (!myConvId) {
      const [result] = await conn.query('INSERT INTO private_conversation (user_id, peer_id, persona_key, is_anonymous) VALUES (?, ?, ?, ?)', [userId, peerId, persona, anonymousRequested ? 1 : 0])
      myConvId = result.insertId
    }
    const [peer] = await conn.query('SELECT id FROM private_conversation WHERE user_id = ? AND peer_id = ? AND persona_key = ? FOR UPDATE', [peerId, userId, persona])
    if (peer.length) peerConvId = peer[0].id
    else {
      // 分身私信（anonSide='self'）中接收方是普通用户：其会话行必须保持 is_anonymous=0，
      // 否则普通用户一方会被永久误标为匿名（聊天页强制进入匿名模式、回复也变成匿名身份）
      const peerAnonymousFlag = anonymousRequested && anonSide !== 'self' ? 1 : 0
      const [result] = await conn.query('INSERT INTO private_conversation (user_id, peer_id, persona_key, is_anonymous) VALUES (?, ?, ?, ?)', [peerId, userId, persona, peerAnonymousFlag])
      peerConvId = result.insertId
    }
    if (anonymousRequested) {
      // 分身私信（anonSide='self'）：仅发起方记为匿名，接收方是普通用户，保持普通身份
      // 回复匿名帖子（anonSide='peer'）：确认弹窗已告知「你也自动变为匿名用户」，双方均记为匿名
      if (anonSide === 'self') {
        await conn.query('UPDATE private_conversation SET is_anonymous = 1 WHERE id = ?', [myConvId])
      } else {
        await conn.query('UPDATE private_conversation SET is_anonymous = 1 WHERE id IN (?, ?)', [myConvId, peerConvId])
      }
    }
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
    // 来源帖子：首次从帖子详情发起私信时记录（只记一次，之后不再覆盖），
    // 双方会话都写入，任何一方从消息列表进入聊天都能「回到帖子」
    const sourcePost = Number(sourcePostId) > 0 ? Math.floor(Number(sourcePostId)) : 0
    if (sourcePost) {
      await conn.query('UPDATE private_conversation SET source_post_id = ? WHERE id IN (?, ?) AND source_post_id IS NULL', [sourcePost, myConvId, peerConvId])
    }
    const [state] = await conn.query(
      `SELECT c.is_anonymous, c.anon_peer_identity, c.anon_self_identity, c.source_post_id, IFNULL(p.is_anonymous, 0) AS peer_is_anonymous
       FROM private_conversation c
       LEFT JOIN private_conversation p ON p.user_id = c.peer_id AND p.peer_id = c.user_id AND p.persona_key = c.persona_key
       WHERE c.id = ?`, [myConvId])
    await conn.commit()
    return {
      myConvId,
      peerConvId,
      personaKey: persona,
      peerInfo: users[0],
      sourcePostId: state[0] ? (Number(state[0].source_post_id) || 0) : 0,
      isAnonymous: !!(state[0] && state[0].is_anonymous),
      peerIsAnonymous: !!(state[0] && Number(state[0].peer_is_anonymous) === 1),
      peerAnonymous: state[0] ? parseAnonymousIdentity(state[0].anon_peer_identity) : null,
      selfAnonymous: state[0] ? parseAnonymousIdentity(state[0].anon_self_identity) : null
    }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function getPendingMessage(userId, peerId, conn = pool, personaKey = '') {
  // The one-message waiting rule only applies before the other participant has
  // ever replied. Once both sides have sent a message, this conversation is open.
  // 等待规则按分身会话隔离：对方在其他分身会话中的回复不影响本会话
  const persona = normalizePersonaKey(personaKey)
  const [replies] = await conn.query(
    `SELECT id FROM private_message
     WHERE sender_id = ? AND receiver_id = ? AND persona_key = ? AND status != 'recalled'
     LIMIT 1`,
    [peerId, userId, persona]
  )
  if (replies.length) return null

  const [rows] = await conn.query(
    `SELECT id FROM private_message
     WHERE sender_id = ? AND receiver_id = ? AND persona_key = ? AND status != 'recalled'
     ORDER BY id DESC LIMIT 1`,
    [userId, peerId, persona]
  )
  return rows[0] || null
}

async function updateConversationPreview(conn, userId, peerId, personaKey = '') {
  const persona = normalizePersonaKey(personaKey)
  const [latest] = await conn.query(
    `SELECT id, content, msg_type, created_at FROM private_message
     WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND persona_key = ? AND status != 'recalled'
     ORDER BY id DESC LIMIT 1`,
    [userId, peerId, peerId, userId, persona]
  )
  const message = latest[0]
  const text = message ? (message.msg_type === 'image' ? '[图片]' : message.content.slice(0, 500)) : ''
  const time = message ? message.created_at : null
  await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = ? WHERE (user_id = ? AND peer_id = ? AND persona_key = ?) OR (user_id = ? AND peer_id = ? AND persona_key = ?)', [message ? message.id : null, text, time, userId, peerId, persona, peerId, userId, persona])
}

async function isBlocked(userId, targetId) {
  if (!userId || !targetId || Number(userId) === Number(targetId)) return false
  const [rows] = await pool.query('SELECT id FROM user_blacklist WHERE user_id = ? AND blocked_id = ? LIMIT 1', [userId, targetId])
  return rows.length > 0
}

/**
 * 解析私信订阅提醒里「发送人」该显示什么昵称。
 *
 * 匿名性完全靠这里守住：匿名方必须用分身昵称（会话里存档的 anon_self_identity，
 * 与聊天页展示的是同一份数据），**绝不回落到 sys_user.nick_name** ——
 * 那等于在微信通知里直接点名匿名者，把「匿名私信」这个功能彻底废掉。
 * 因此匿名分支刻意不查用户表。
 *
 * 判定依据是 conversation.isAnonymous（我这一侧是否匿名），而不是 channelAnonymous：
 * 普通用户回复匿名发起人时，聊天页显示的是该普通用户的真实昵称，推送文案必须一致。
 *
 * @returns {Promise<string>} 永不为空（兜底「匿名用户」/「有同学」），
 *   因为微信对 data 里的空值字段直接返回 47003，且该错误不可重试。
 */
function resolveSenderNick(conversation, senderId) {
  if (conversation && conversation.isAnonymous) {
    const anon = conversation.selfAnonymous || {}
    const nickName = String(anon.nickName || '').trim()
    return Promise.resolve(nickName || '分身用户')
  }
  // 普通方：查真实昵称，查不到时用中性称呼兜底
  return pool.query('SELECT nick_name FROM sys_user WHERE id = ? LIMIT 1', [senderId])
    .then(([rows]) => (rows[0] && rows[0].nick_name) || '有同学')
}

async function createPrivateMessage(senderId, receiverId, content, msgType = 'text', anonymousRequested = false, anonymousIdentity = null, personaKey = '', sourcePostId = 0) {
  // 拉黑双向拦截：接收方拉黑发送方时拒绝投递，发送方拉黑接收方时提示先解除
  if (await isBlocked(receiverId, senderId)) throw new Error('消息发送失败，对方已将你加入黑名单')
  if (await isBlocked(senderId, receiverId)) throw new Error('你已拉黑对方，请先解除拉黑后再发送')
  // 匿名发送方身份：优先用客户端上传的分身形象，否则服务端生成随机分身并存档，
  // 保证收信方会话列表与聊天页显示统一的匿名昵称头像（存档只写一次，之后不覆盖）
  const identity = anonymousRequested
    ? (parseAnonymousIdentity(anonymousIdentity) || generateAnonIdentity())
    : null
  // 分身会话键：优先用入口显式传入的分身标识；未传时以最终存档的分身头像兜底，
  // 保证同一分身始终落在同一个隔离会话中
  const persona = normalizePersonaKey(personaKey) || (identity ? normalizePersonaKey(identity.avatarUrl) : '')
  // 来源帖子：会话若由本条首消息创建（历史接口失败/离线补发等），在此一并记录，
  // 保证任何入口进入聊天都能「回到帖子」（服务端只在为空时写入，不会覆盖已有来源）
  const conversation = await getOrCreateConversation(senderId, receiverId, anonymousRequested, identity, 'self', persona, sourcePostId)
  // 会话只要存在匿名侧（即匿名发起方），消息统一走匿名渠道，双方查看/回复都落在同一份记录里
  const channelAnonymous = conversation.isAnonymous || conversation.peerIsAnonymous
  const text = String(content).trim()
  const type = ['text', 'image', 'emoji', 'video'].includes(msgType) ? msgType : 'text'
  const lastText = type === 'image' ? '[图片]' : type === 'video' ? '[视频]' : text.slice(0, 500)
  const conn = await pool.getConnection()
  let messageId
  try {
    await conn.beginTransaction()
    // Lock the sender's conversation row so concurrent requests cannot bypass the one-message rule.
    await conn.query('SELECT id FROM private_conversation WHERE id = ? FOR UPDATE', [conversation.myConvId])
    if (await getPendingMessage(senderId, receiverId, conn, persona)) throw new Error('请等待对方回复后再发送；可长按上一条消息撤回')
    // 按会话的匿名侧标记消息渠道，匿名/普通私信在同一会话内各看各的记录；
    // persona_key 让不同分身的消息彻底隔离，互不串扰
    const [result] = await conn.query('INSERT INTO private_message (conversation_id, sender_id, receiver_id, persona_key, content, msg_type, is_anonymous) VALUES (?, ?, ?, ?, ?, ?, ?)', [conversation.myConvId, senderId, receiverId, persona, text, type, channelAnonymous ? 1 : 0])
    messageId = result.insertId
    await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW() WHERE id = ?', [messageId, lastText, conversation.myConvId])
    await conn.query('UPDATE private_conversation SET last_message_id = ?, last_message_text = ?, last_message_time = NOW(), unread_count = unread_count + 1 WHERE id = ?', [messageId, lastText, conversation.peerConvId])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  const data = { id: messageId, senderId, receiverId, personaKey: persona, content: text, msgType: type, createdAt: new Date().toISOString(), status: 'sent', isAnonymous: channelAnonymous }
  wsServer.sendToUser(receiverId, { type: 'private_message', data })
  // 私信订阅提醒：匿名渠道同样推送。
  // 原先匿名渠道整块跳过 pushMessage，导致「对方明明开了订阅也永远收不到匿名私信提醒」，
  // 且 subscribe_message_log 里连一行记录都不留（既无 sent 也无 skipped），排查时极易误判成额度不足。
  // 匿名性改由「发送人昵称」守住：匿名方一律用分身昵称，绝不回落到真实昵称。
  //
  // 判定用 conversation.isAnonymous（**我这一侧**是否匿名），而不是 channelAnonymous：
  // 会话任一侧匿名时整条会话都走匿名渠道，但普通用户回复匿名发起人时聊天页显示的是
  // 该普通用户的真实昵称，推送文案必须与之一致，否则对方看到的身份对不上。
  const digest = type === 'image' ? '[图片]' : type === 'video' ? '[视频]' : text.slice(0, 20)
  resolveSenderNick(conversation, senderId)
    .then((senderNick) => subscribeService.pushMessage(receiverId, { senderNick, digest }))
    .catch((e) => console.error('[MessageSubscribe]', e.message))
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
      { nickName: req.body.anonNick, avatarUrl: req.body.anonAvatar },
      req.body.personaKey,
      // 来源帖子：客户端从帖子页发起私信时随每条消息带上，保证首条消息创建会话时也记录来源
      parseInt(req.body.postId, 10) || 0
    )
    success(res, { id: message.id, status: message.status, createdAt: message.createdAt, isAnonymous: message.isAnonymous, personaKey: message.personaKey })
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
    // 分身会话键：入口显式传入优先；匿名入口未传时以分身头像兜底。
    // history 只读取该分身自己的消息，其他分身/普通渠道的记录不会出现在本会话
    const personaKey = normalizePersonaKey(req.query.personaKey) ||
      (req.query.anonymous === '1' && anonIdentity ? normalizePersonaKey(anonIdentity.avatarUrl) : '')
    let anonSide = req.query.anonSide === 'self' ? 'self' : 'peer'
    let anonymousRequested = req.query.anonymous === '1'
    // 会话已存在时按库内匿名归属推导，纠正客户端未传 anonSide 的重进场景：
    // 1) 本人行匿名、对方行普通 → 分身属于请求方本人（anonSide='self'），不得翻转对方；
    // 2) 本人行普通 → 请求方是普通参与者，只读历史，不触发任何匿名标记更新；
    // 3) 双方均匿名（匿名帖回复渠道）→ 保持 'peer'，更新为幂等无副作用。
    if (anonymousRequested) {
      const [convRows] = await pool.query(
        `SELECT user_id, is_anonymous FROM private_conversation
         WHERE persona_key = ? AND ((user_id = ? AND peer_id = ?) OR (user_id = ? AND peer_id = ?))`,
        [personaKey, req.userId, peerId, peerId, req.userId]
      )
      if (convRows.length === 2) {
        const mine = convRows.find((r) => Number(r.user_id) === Number(req.userId))
        const peerRow = convRows.find((r) => Number(r.user_id) !== Number(req.userId))
        if (Number(mine.is_anonymous) === 1 && Number(peerRow.is_anonymous) === 0) anonSide = 'self'
        else if (Number(mine.is_anonymous) === 0) anonymousRequested = false
      }
    }
    const conversation = await getOrCreateConversation(req.userId, peerId, anonymousRequested, anonIdentity, anonSide, personaKey, parseInt(req.query.postId, 10) || 0)
    // 消息渠道按会话实际的匿名侧计算：任一方是匿名发起方，双方查看/回复都落在同一匿名渠道，
    // 普通用户一方也能看到匿名消息并正常回复
    const channelAnonymous = conversation.isAnonymous || conversation.peerIsAnonymous
    const params = [req.userId, peerId, peerId, req.userId, conversation.personaKey, channelAnonymous ? 1 : 0]
    const [countRows] = await pool.query("SELECT COUNT(*) AS total FROM private_message WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND persona_key = ? AND status != 'recalled' AND is_anonymous = ?", params)
    const [rows] = await pool.query(
      `SELECT m.*, u.nick_name AS sender_nick, u.avatar_url AS sender_avatar FROM private_message m
       LEFT JOIN sys_user u ON m.sender_id = u.id
       WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)) AND m.persona_key = ? AND m.status != 'recalled' AND m.is_anonymous = ?
       ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      params.concat([pageSize, offset])
    )
    const total = countRows[0].total
    const pending = await getPendingMessage(req.userId, peerId, pool, conversation.personaKey)
    const [blocked, blockedByPeer] = await Promise.all([isBlocked(req.userId, peerId), isBlocked(peerId, req.userId)])
    // 匿名渠道消息：LEFT JOIN sys_user 带出的是发送方真实身份，他人发送的消息必须清洗，
    // 优先用存档的分身身份展示；无存档分身时兜底用对方真实昵称头像（对方发帖时所用身份），
    // 不再显示笼统的「匿名用户」；自己发送的保留真实身份（前端匿名模式也不使用 senderAvatar）
    const fallbackNick = (conversation.peerInfo && conversation.peerInfo.nick_name) || '校园同学'
    const fallbackAvatar = (conversation.peerInfo && conversation.peerInfo.avatar_url) || '/assets/icons/avatar.png'
    const list = rows.map((r) => {
      const item = { id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, receiverId: r.receiver_id, personaKey: r.persona_key, content: r.content, msgType: r.msg_type, status: r.status, senderNick: r.sender_nick, senderAvatar: r.sender_avatar, createdAt: r.created_at }
      if (channelAnonymous && Number(r.sender_id) !== Number(req.userId)) {
        const persona = conversation.peerAnonymous
        item.senderNick = persona ? persona.nickName : fallbackNick
        item.senderAvatar = persona ? persona.avatarUrl : fallbackAvatar
      }
      return item
    })
    // 对方身份展示：有存档分身时下发分身（peerAnonymous）；
    // 没有时下发对方真实身份（peerNormal，即对方发布帖子所用的头像昵称），前端不再误显示为「匿名用户」
    const peerNormal = !conversation.peerAnonymous
      ? { nickName: fallbackNick, avatarUrl: fallbackAvatar }
      : null
    success(res, { list: list.reverse(), total, hasMore: offset + pageSize < total, canSend: !pending && !blocked && !blockedByPeer, pendingMessageId: pending ? pending.id : 0, isAnonymous: conversation.isAnonymous, personaKey: conversation.personaKey, peerNormal, blocked, blockedByPeer, peerAnonymous: conversation.peerAnonymous, selfAnonymous: conversation.selfAnonymous, sourcePostId: conversation.sourcePostId || 0 })
  } catch (e) { fail(res, safeMessage(e), 400) }
}

exports.recall = async (req, res) => {
  const messageId = Number(req.params.id)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT id, sender_id, receiver_id, persona_key, status FROM private_message WHERE id = ? FOR UPDATE', [messageId])
    const message = rows[0]
    if (!message || Number(message.sender_id) !== Number(req.userId) || message.status === 'recalled') throw new Error('消息无法撤回')
    // 「对方已回复」判断限定在同一分身会话内，其他分身的回复不影响本会话撤回
    const [replies] = await conn.query("SELECT id FROM private_message WHERE sender_id = ? AND receiver_id = ? AND persona_key = ? AND status != 'recalled' AND id > ? LIMIT 1", [message.receiver_id, message.sender_id, message.persona_key, message.id])
    if (replies.length) throw new Error('对方已回复，无法撤回')
    // 撤回时尚未读的消息需同步扣减对方会话未读数，否则徽标出现永久幽灵未读
    const wasUnread = message.status && message.status !== 'read'
    await conn.query("UPDATE private_message SET status = 'recalled' WHERE id = ?", [messageId])
    if (wasUnread) {
      await conn.query(
        'UPDATE private_conversation SET unread_count = GREATEST(unread_count - 1, 0) WHERE user_id = ? AND peer_id = ? AND persona_key = ?',
        [message.receiver_id, message.sender_id, message.persona_key]
      )
    }
    await conn.query('INSERT INTO private_message_recall_log (message_id, operator_id, receiver_id) VALUES (?, ?, ?)', [messageId, req.userId, message.receiver_id])
    await updateConversationPreview(conn, message.sender_id, message.receiver_id, message.persona_key)
    await conn.commit()
    wsServer.sendToUser(message.receiver_id, { type: 'private_message_recalled', data: { id: messageId, peerId: req.userId, personaKey: message.persona_key } })
    success(res, null)
  } catch (e) { await conn.rollback(); fail(res, safeMessage(e), 400) } finally { conn.release() }
}

exports.conversations = async (req, res) => {
  try {
    // 会话按分身隔离：同一真实用户的每个分身各自一行，persona_key 标识所属分身
    const [rows] = await pool.query(`SELECT c.id, c.peer_id, c.persona_key, c.unread_count, c.last_message_text, c.last_message_time, c.is_anonymous, c.anon_peer_identity, IFNULL(p.is_anonymous, 0) AS peer_is_anonymous, u.nick_name AS peer_nick, u.avatar_url AS peer_avatar FROM private_conversation c LEFT JOIN sys_user u ON c.peer_id = u.id LEFT JOIN private_conversation p ON p.user_id = c.peer_id AND p.peer_id = c.user_id AND p.persona_key = c.persona_key WHERE c.user_id = ? AND c.status = 1 ORDER BY c.last_message_time DESC`, [req.userId])
    success(res, { list: rows.map((r) => {
      // 匿名会话已存档过分身身份时，列表也展示分身，保证各入口一致；
      // 无存档分身（含历史遗留会话）时兜底展示对方真实昵称头像，
      // 即对方发布帖子时所用的头像与昵称，不再显示笼统的「匿名用户」
      const persona = parseAnonymousIdentity(r.anon_peer_identity)
      const fallbackNick = persona ? persona.nickName : (r.peer_nick || '校园同学')
      // 兜底头像同样要过归一化：对方 avatar_url 里可能存着重命名前的旧文件名
      // （/assets/avatar2/1%20(9).jpg、/assets/avatar1/考拉 (2).jpg），
      // 直出会让会话列表头像空白并在渲染层刷「Failed to load image」。
      const fallbackAvatar = persona
        ? persona.avatarUrl
        : normalizeLegacyAvatarUrl(r.peer_avatar || '/assets/icons/avatar.png')
      return { id: r.id, peerId: r.peer_id, personaKey: r.persona_key || '', peerNick: fallbackNick, peerAvatar: fallbackAvatar, unreadCount: r.unread_count, lastMessage: r.last_message_text, lastTime: r.last_message_time, isAnonymous: !!r.is_anonymous }
    }) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.markRead = async (req, res) => {
  const peerId = parseInt(req.body.peerId, 10)
  if (!peerId) return fail(res, '缺少peerId')
  try {
    // 按分身会话清零未读：personaKey 缺省为 ''（普通会话），只影响对应那一行
    const persona = normalizePersonaKey(req.body.personaKey)
    await pool.query('UPDATE private_conversation SET unread_count = 0 WHERE user_id = ? AND peer_id = ? AND persona_key = ?', [req.userId, peerId, persona])
    await pool.query("UPDATE private_message SET status = 'read' WHERE sender_id = ? AND receiver_id = ? AND persona_key = ? AND status NOT IN ('read', 'recalled')", [peerId, req.userId, persona])
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 400) }
}

exports.unreadCount = async (req, res) => {
  try { const [rows] = await pool.query('SELECT IFNULL(SUM(unread_count), 0) AS total FROM private_conversation WHERE user_id = ? AND status = 1', [req.userId]); success(res, { total: rows[0].total }) } catch (e) { fail(res, safeMessage(e), 500) }
}

// P11：消息状态白名单 —— 每种状态只允许「持有该状态语义的那一方」按既定顺序推进，
// 不再让任一参与方把消息改成任意值（例如把已读倒回未读、伪造撤回）：
//   delivered/read 只有接收方能报，failed 只有发送方能报，recalled 只走撤回接口。
const STATUS_TRANSITIONS = {
  delivered: { role: 'receiver', from: ['sent'] },
  read: { role: 'receiver', from: ['sending', 'sent', 'delivered'] },
  failed: { role: 'sender', from: ['sending', 'sent'] },
}

exports.updateStatus = async (req, res) => {
  const messageId = parseInt(req.body.messageId, 10)
  const status = String(req.body.status || '')
  // 只认自有键，避开 Object.prototype 上的属性（'constructor'/'toString' 等不能当成规则）
  const rule = Object.prototype.hasOwnProperty.call(STATUS_TRANSITIONS, status) ? STATUS_TRANSITIONS[status] : null
  if (!rule) return fail(res, '不支持的消息状态', 400)
  if (!messageId) return fail(res, '参数不完整')
  try {
    const ownerColumn = rule.role === 'receiver' ? 'receiver_id' : 'sender_id'
    const placeholders = rule.from.map(() => '?').join(', ')
    const [result] = await pool.query(
      `UPDATE private_message SET status = ? WHERE id = ? AND ${ownerColumn} = ? AND status IN (${placeholders})`,
      [status, messageId, req.userId].concat(rule.from),
    )
    // 0 行 = 消息不存在、不属于当前用户、或状态已经推进过（幂等，前端可安全重试）
    if (!result.affectedRows) return fail(res, '消息状态未变更', 400)
    success(res, { status })
  } catch (e) { fail(res, safeMessage(e), 500) }
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
      `SELECT b.blocked_id AS userId, u.nick_name AS nick, u.avatar_url AS avatar, u.campus, u.cert_label AS certLabel, u.is_verified AS verified, u.created_at AS registeredAt, b.created_at FROM user_blacklist b
       LEFT JOIN sys_user u ON b.blocked_id = u.id WHERE b.user_id = ? ORDER BY b.created_at DESC`, [req.userId])
    success(res, { list: rows.map((r) => ({ userId: r.userId, nick: r.nick, avatar: r.avatar, campus: r.campus || '', certLabel: r.certLabel || '', verified: !!r.verified, registeredAt: r.registeredAt, createdAt: r.created_at })) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}
