/**
 * 匿名私信订阅提醒测试（无需数据库）
 *
 * 背景：`createPrivateMessage()` 过去把整块推送逻辑包在 `if (!channelAnonymous)` 里，
 * 于是匿名/分身私信**永远不推** —— 用户反馈「对方明明开了订阅也收不到匿名私信提醒」，
 * 而且 `subscribe_message_log` 里连一行记录都不留（既无 `sent` 也无 `skipped`），
 * 与「额度不足」的症状极像，排查时极易误判。根因由 commit a863751b 引入。
 *
 * 现在的契约：
 *   1) 匿名渠道同样推送（否则对方收不到任何微信提示）；
 *   2) 匿名性改由「发送人昵称」守住 —— 匿名方必须用分身昵称，
 *      且**绝不能查 sys_user.nick_name**（那等于在微信通知里直接点名匿名者）；
 *   3) 判定用 conversation.isAnonymous（**我这一侧**是否匿名），而不是 channelAnonymous：
 *      普通用户回复匿名发起人时，聊天页显示的是该普通用户的真名，推送文案也必须一致；
 *   4) senderNick 永不为空（微信对 data 里的空值字段直接返回 47003，且不可重试）；
 *   5) A1/A2/A3 三条站内通道不得被破坏：WebSocket 无条件先发、未读角标更新、冷启动提示。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}

const ANON_NICK = '深幽的洞穴'
const REAL_NICK = '广轻观察'
const PEER_NICK = '凋零的花瓣'
const ANON_AVATAR = '/assets/avatar1/熊猫.jpg'

let sqlLog = []
let pushLog = []
let wsLog = []
let state = {}

function resetState(over) {
  state = Object.assign({
    myConvAnonymous: false,
    peerConvAnonymous: false,
    selfAnon: null,
    peerAnon: null,
    realNick: REAL_NICK,
  }, over || {})
  sqlLog = []
  pushLog = []
  wsLog = []
}

// ===== 假 pool：按 SQL 文本分派返回值，同时记录所有 SQL 供「不得查真名」断言 =====
async function fakeQuery(sql, params) {
  const text = String(sql).replace(/\s+/g, ' ').trim()
  sqlLog.push(text)
  if (/^INSERT INTO private_message/.test(text)) return [{ insertId: 999, affectedRows: 1 }]
  if (/^INSERT INTO private_conversation/.test(text)) return [{ insertId: 150, affectedRows: 1 }]
  if (/^UPDATE/.test(text)) return [{ affectedRows: 1 }]
  if (/FROM user_blacklist/.test(text)) return [[]]
  if (/SELECT id, nick_name, avatar_url, allow_anonymous_pm FROM sys_user/.test(text)) {
    return [[{ id: 2, nick_name: PEER_NICK, avatar_url: '/assets/avatar2/1.jpg', allow_anonymous_pm: 1 }]]
  }
  if (/SELECT id, is_anonymous FROM private_conversation/.test(text)) {
    return [[{ id: 100, is_anonymous: state.myConvAnonymous ? 1 : 0 }]]
  }
  if (/SELECT id FROM private_conversation WHERE user_id = \? AND peer_id = \? AND persona_key = \? FOR UPDATE/.test(text)) {
    return [[{ id: 200 }]]
  }
  if (/SELECT c\.is_anonymous, c\.anon_peer_identity/.test(text)) {
    return [[{
      is_anonymous: state.myConvAnonymous ? 1 : 0,
      anon_peer_identity: state.peerAnon,
      anon_self_identity: state.selfAnon,
      source_post_id: null,
      peer_is_anonymous: state.peerConvAnonymous ? 1 : 0,
    }]]
  }
  // 待回复检查：返回「对方回复过」→ 不受「发一条等回复」限制
  if (/FROM private_message WHERE sender_id/.test(text)) return [[{ id: 1 }]]
  if (/SELECT nick_name FROM sys_user WHERE id = \?/.test(text)) return [[{ nick_name: state.realNick }]]
  return [[]]
}

const fakePool = {
  async query(sql, params) { return fakeQuery(sql, params) },
  async getConnection() {
    return {
      async query(sql, params) { return fakeQuery(sql, params) },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
    }
  },
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }

const SUB_PATH = require.resolve('../services/subscribeService')
require.cache[SUB_PATH] = {
  id: SUB_PATH,
  filename: SUB_PATH,
  loaded: true,
  exports: {
    TPL_TYPES: ['message', 'commentNew'],
    pushMessage(userId, payload) {
      pushLog.push({ userId, payload })
      return Promise.resolve({ sent: true })
    },
  },
}

const WS_PATH = require.resolve('../ws/wsServer')
require.cache[WS_PATH] = {
  id: WS_PATH,
  filename: WS_PATH,
  loaded: true,
  exports: {
    init() {},
    broadcast() {},
    isOnline() { return false },
    sendToUser(userId, payload) { wsLog.push({ userId, payload }) },
  },
}

const controller = require('../controllers/messageController')
const CONTROLLER_SRC = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'messageController.js'), 'utf8')

// 等 pushMessage 的 then 链跑完（发送是 fire-and-forget，不能阻塞主流程）
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function run(over, body) {
  resetState(over)
  await controller.createPrivateMessage(
    1,
    2,
    body.content === undefined ? '3' : body.content,
    'text',
    !!body.anonymous,
    body.identity || null,
    body.personaKey || '',
    0
  )
  await flush()
  await flush()
  await flush()
}

const REAL_NICK_SQL = /SELECT nick_name FROM sys_user WHERE id = \?/
function realNickQueries() {
  return sqlLog.filter((s) => REAL_NICK_SQL.test(s))
}

async function main() {
  // ===== 1) 匿名发起方：必须推送，且发送人用分身昵称 =====
  await run(
    { myConvAnonymous: true, selfAnon: JSON.stringify({ nickName: ANON_NICK, avatarUrl: ANON_AVATAR }) },
    { anonymous: true, identity: { nickName: ANON_NICK, avatarUrl: ANON_AVATAR }, personaKey: ANON_AVATAR }
  )
  check(() => {
    assert.strictEqual(pushLog.length, 1, '匿名私信必须下发订阅消息（旧实现整块跳过，对方永远收不到）')
    assert.strictEqual(pushLog[0].userId, 2, '收件人应是对方')
    assert.strictEqual(pushLog[0].payload.senderNick, ANON_NICK, '匿名方必须用分身昵称')
    assert.notStrictEqual(pushLog[0].payload.senderNick, REAL_NICK, '绝不能出现真实昵称')
    assert.strictEqual(pushLog[0].payload.digest, '3', 'digest 应是消息内容摘要')
  }, '匿名发起方：推送且用分身昵称')

  check(() => {
    assert.deepStrictEqual(realNickQueries(), [],
      '匿名分支不得查询 sys_user.nick_name —— 那等于在微信通知里点名匿名者')
  }, '匿名分支不查真实昵称')

  // ===== 2) 普通私信：仍用真实昵称 =====
  await run({ myConvAnonymous: false, peerConvAnonymous: false }, { anonymous: false })
  check(() => {
    assert.strictEqual(pushLog.length, 1, '普通私信应推送')
    assert.strictEqual(pushLog[0].payload.senderNick, REAL_NICK, '普通方用真实昵称')
    assert.ok(realNickQueries().length > 0, '普通分支应查真实昵称')
  }, '普通私信：真实昵称')

  // ===== 3) 关键回归：普通用户回复匿名发起人 =====
  // 会话任一侧匿名时 channelAnonymous 为真，但「我」这一侧是普通身份，
  // 聊天页显示的是我的真名 —— 推送文案必须一致，且这一条也必须能推出去。
  await run(
    { myConvAnonymous: false, peerConvAnonymous: true, peerAnon: JSON.stringify({ nickName: '浅浅的沙丘', avatarUrl: ANON_AVATAR }) },
    { anonymous: false }
  )
  check(() => {
    assert.strictEqual(pushLog.length, 1,
      '对方是匿名方时我回复也必须推送（旧实现按 channelAnonymous 整块跳过，对方永远收不到）')
    assert.strictEqual(pushLog[0].payload.senderNick, REAL_NICK,
      '我这一侧是普通身份，文案应与聊天页一致用真名')
  }, '普通回复匿名方：仍推送')

  // ===== 4) 分身身份缺失：中性兜底，绝不回落真名 =====
  await run({ myConvAnonymous: true, selfAnon: null }, { anonymous: true, identity: null, personaKey: ANON_AVATAR })
  check(() => {
    assert.strictEqual(pushLog.length, 1, '即使分身身份缺失也必须推送')
    assert.strictEqual(pushLog[0].payload.senderNick, '分身用户', '缺失时用中性兜底')
    assert.ok(String(pushLog[0].payload.senderNick).length > 0,
      'senderNick 不得为空（微信对空值字段直接返回 47003，不可重试）')
    assert.deepStrictEqual(realNickQueries(), [], '兜底路径同样不得查真实昵称')
  }, '分身身份缺失：中性兜底且不泄露')

  // ===== 5) 源码护栏：不得再按 channelAnonymous 跳过推送 =====
  check(() => {
    assert.ok(CONTROLLER_SRC.indexOf('function resolveSenderNick') > -1, '应保留 resolveSenderNick')
    // 锚点必须落在「调用处」：函数定义本身也含 resolveSenderNick(conversation, senderId)，
    // 用它做 indexOf 会命中定义行，导致下面的先后顺序断言永远算错
    assert.match(CONTROLLER_SRC, /resolveSenderNick\(conversation, senderId\)\s*\r?\n\s*\.then\(/, '推送前应经 resolveSenderNick')
    assert.ok(!/if\s*\(\s*!channelAnonymous\s*\)/.test(CONTROLLER_SRC),
      '不应再出现 if (!channelAnonymous) —— 那会让匿名渠道彻底不推')
    assert.ok(!/匿名渠道不推/.test(CONTROLLER_SRC), '旧注释应一并移除，避免误导')
  }, '源码护栏')

  // ===== 6) A1：WebSocket 实时通道必须无条件先发（不能被匿名判断包住）=====
  check(() => {
    const wsIdx = CONTROLLER_SRC.indexOf("wsServer.sendToUser(receiverId, { type: 'private_message', data })")
    // 同样必须锚定调用处：定义在文件前半部分，用它算顺序会得到错误结果
    const pushIdx = CONTROLLER_SRC.indexOf('subscribeService.pushMessage(receiverId, { senderNick, digest })')
    assert.ok(wsIdx > -1, 'A1：应保留 WebSocket 实时下发')
    assert.ok(pushIdx > -1, '应存在订阅推送调用')
    assert.ok(wsIdx < pushIdx, 'A1：WebSocket 必须在订阅推送之前无条件执行')
    assert.strictEqual(wsLog.length, 1, 'A1：匿名路径也要实时下发 private_message')
  }, 'A1 WebSocket 实时通道')

  // ===== 7) A2：未读总数与 tabBar 角标 =====
  check(() => {
    const store = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'messageStore.js'), 'utf8')
    assert.match(store, /if \(msg\.type === 'private_message'\)/, 'A2：WebSocket 应处理 private_message')
    assert.match(store, /setUnreadTotal\(total\)/, 'A2：应更新未读总数')
    assert.match(store, /function updateTabBarBadge/, 'A2：应更新 tabBar 角标')
    assert.match(store, /setUnreadTotal[\s\S]{0,200}updateTabBarBadge\(n\)/,
      'A2：更新未读时必须联动角标，否则用户看不到红点')
  }, 'A2 未读与角标')

  // ===== 8) A3：冷启动未读提示 =====
  check(() => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8')
    assert.match(app, /noticeColdStartUnread\s*\(total\)\s*\{/, 'A3：应定义 noticeColdStartUnread')
    assert.match(app, /syncUnreadCount\(\)\.then\(\(total\) => this\.noticeColdStartUnread\(total\)\)/,
      'A3：冷启动拿到未读总数后应触发提示')
    assert.match(app, /你有 ' \+ n \+ ' 条新消息/, 'A3：应有可见提示（toast 文案）')
    assert.match(app, /_coldStartUnreadNoticed/, 'A3：应保证一次冷启动只提示一次')
  }, 'A3 冷启动提示')

  console.log(testCount + ' tests passed.')
}

main().catch((err) => {
  console.error('anonymous message subscribe tests failed:', err.message)
  process.exit(1)
})
