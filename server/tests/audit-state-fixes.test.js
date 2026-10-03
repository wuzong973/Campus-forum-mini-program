// 运行态回归：P05 接单大厅状态口径、P11 消息状态白名单、P19 投票唯一键、P22 计数双写门控。
// 这些逻辑「读 SQL 文本看不出问题、跑一遍才知道」，因此用假连接池真实调用控制器。
const assert = require('assert')

const SQL_LOG = []
let state = {}

function record(sql, params) {
  const text = String(sql).replace(/\s+/g, ' ').trim()
  SQL_LOG.push({ sql: text, params: params || [] })
  return text
}

const fakePool = {
  async query(sql, params) {
    return handle(record(sql, params), params)
  },
  async getConnection() {
    return {
      async beginTransaction() {},
      async commit() { state.committed = true },
      async rollback() { state.rolledBack = true },
      release() {},
      async query(sql, params) {
        return handle(record(sql, params), params)
      },
    }
  },
}

function lastSql() {
  return SQL_LOG[SQL_LOG.length - 1].sql
}

function handle(text, params) {
  // ---- 跑腿列表（P05）----
  if (/^SELECT COUNT\(\*\) AS total FROM errand_order e WHERE/.test(text)) {
    state.hallWhere = text
    state.hallParams = params || []
    return [[{ total: 0 }]]
  }
  if (/^SELECT e\.id, e\.publisher_id, e\.acceptor_id, e\.type, e\.title/.test(text)) return [[]]
  if (/^SELECT role, campus FROM sys_user WHERE id = \?/.test(text)) return [[]]

  // ---- 私信状态（P11）----
  if (/^UPDATE private_message SET status = \? WHERE id = \? AND (receiver|sender)_id = \? AND status IN/.test(text)) {
    return [{ affectedRows: 1 }]
  }

  // ---- 帖子点赞 / 蹲贴（P22）----
  if (/^SELECT id FROM forum_like WHERE post_id = \? AND user_id = \?/.test(text)) return [state.liked ? [{ id: 1 }] : []]
  if (/^INSERT IGNORE INTO forum_like/.test(text)) return [{ affectedRows: state.liked ? 0 : 1 }]
  if (/^DELETE FROM forum_like/.test(text)) return [{ affectedRows: state.liked ? 1 : 0 }]
  if (/^SELECT id FROM forum_post WHERE id = \? AND status = 1/.test(text)) return [[{ id: 55 }]]
  if (/^SELECT user_id, title FROM forum_post WHERE id = \?/.test(text)) return [[]]
  if (/^SELECT id FROM forum_post_follow WHERE post_id = \? AND user_id = \?/.test(text)) return [state.followed ? [{ id: 1 }] : []]
  if (/^INSERT IGNORE INTO forum_post_follow/.test(text)) return [{ affectedRows: state.followed ? 0 : 1 }]
  if (/^DELETE FROM forum_post_follow/.test(text)) return [{ affectedRows: state.followed ? 1 : 0 }]
  if (/^SELECT follow_count FROM forum_post WHERE id = \?/.test(text)) return [[{ follow_count: 2 }]]

  // ---- 帖子投票（P19）----
  if (/^SELECT components FROM forum_post WHERE id = \? AND status = 1 FOR UPDATE/.test(text)) {
    return [[{ components: JSON.stringify(state.pollComponents) }]]
  }
  if (/^INSERT INTO forum_poll_vote/.test(text)) {
    if (state.pollVoted) {
      const error = new Error("Duplicate entry '55-0-7' for key 'uk_poll_vote'")
      error.code = 'ER_DUP_ENTRY'
      throw error
    }
    return [{ affectedRows: 1 }]
  }
  if (/^UPDATE forum_post SET components = \? WHERE id = \?/.test(text)) return [{ affectedRows: 1 }]
  return [[]]
}

const POOL_PATH = require.resolve('../config/pool')
require.cache[POOL_PATH] = { id: POOL_PATH, filename: POOL_PATH, loaded: true, exports: fakePool }
// 通知链路不属于本次断言范围，直接吞掉，避免真实建表/推送
const NOTIF_PATH = require.resolve('../services/notificationService')
require.cache[NOTIF_PATH] = {
  id: NOTIF_PATH,
  filename: NOTIF_PATH,
  loaded: true,
  exports: { async createNotification() { return null }, withMediaPlaceholder: (text) => text },
}

const errandController = require('../controllers/errandController')
const messageController = require('../controllers/messageController')
const postController = require('../controllers/postController')

function makeRes() {
  return {
    locals: {},
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

let passed = 0
function check(label, fn) {
  fn()
  passed += 1
  console.log(`PASS: ${label}`)
}

async function main() {
  // ================= P05 =================
  state = {}
  SQL_LOG.length = 0
  await errandController.list({ query: { status: 'active', page: 1, pageSize: 20 }, userId: 0 }, makeRes())
  check('P05 大厅 active 覆盖 pending/accepted/finishing/disputed', () => {
    assert.ok(state.hallWhere, '应执行列表统计查询')
    // 控制器已按占位符铁律参数化，口径校验改为展开 params：
    // 公开态 pending/accepted（所有人可见）+ 交接态 finishing/disputed（仅当事人）
    const statusParams = (state.hallParams || []).filter((p) =>
      ['pending', 'accepted', 'finishing', 'disputed'].includes(p))
    assert.deepStrictEqual([...new Set(statusParams)].sort(),
      ['accepted', 'disputed', 'finishing', 'pending'], 'active 口径必须覆盖四态（看参数展开）')
    // 已完成订单永久留存并对所有人可见（产品口径调整），但交接态仍必须与当事人条件同分支
    assert.match(state.hallWhere,
      /e\.status IN \(\?, \?\) OR e\.status = 'finished' OR \(e\.status IN \(\?, \?\) AND \(e\.publisher_id = \? OR e\.acceptor_id = \?\)\)/,
      '已完成单所有人可见；交接态必须与当事人条件同分支（仅当事人可见）')
    assert.ok(!/e\.status IN \('pending', 'accepted'\)/.test(state.hallWhere), '不能退回只含两态的旧口径')
  })

  state = {}
  SQL_LOG.length = 0
  await errandController.list({ query: { status: 'finished', page: 1, pageSize: 20 }, userId: 0 }, makeRes())
  check('P05 单状态筛选仍走等值查询', () => {
    assert.match(state.hallWhere, /AND e\.status = \?/, 'finished 仍是参数化等值过滤')
    assert.ok(!/IN \('pending', 'accepted'/.test(state.hallWhere), '不应混入 active 分支')
  })

  // ================= P11 =================
  state = {}
  SQL_LOG.length = 0
  const recalled = makeRes()
  await messageController.updateStatus({ body: { messageId: 12, status: 'recalled' }, userId: 7 }, recalled)
  check('P11 撤回态被拒绝且不产生任何 SQL', () => {
    assert.strictEqual(recalled.statusCode, 400)
    assert.strictEqual(recalled.body.message, '不支持的消息状态')
    assert.strictEqual(SQL_LOG.length, 0)
  })

  SQL_LOG.length = 0
  const readRes = makeRes()
  await messageController.updateStatus({ body: { messageId: 12, status: 'read' }, userId: 7 }, readRes)
  check('P11 read 只允许接收方按 sending/sent/delivered 推进', () => {
    assert.strictEqual(readRes.body.code, 200)
    assert.match(lastSql(), /UPDATE private_message SET status = \? WHERE id = \? AND receiver_id = \? AND status IN \(\?, \?, \?\)/)
    assert.deepStrictEqual(SQL_LOG[0].params, ['read', 12, 7, 'sending', 'sent', 'delivered'])
  })

  SQL_LOG.length = 0
  const failedRes = makeRes()
  await messageController.updateStatus({ body: { messageId: 12, status: 'failed' }, userId: 7 }, failedRes)
  check('P11 failed 只允许发送方推进', () => {
    assert.strictEqual(failedRes.body.code, 200)
    assert.match(lastSql(), /AND sender_id = \? AND status IN \(\?, \?\)/)
    assert.deepStrictEqual(SQL_LOG[0].params, ['failed', 12, 7, 'sending', 'sent'])
  })

  SQL_LOG.length = 0
  for (const tricky of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const res = makeRes()
    await messageController.updateStatus({ body: { messageId: 12, status: tricky }, userId: 7 }, res)
    assert.strictEqual(res.statusCode, 400, tricky + ' 不能被当成状态规则')
    assert.strictEqual(res.body.message, '不支持的消息状态', tricky + ' 应回白名单错误')
  }
  assert.strictEqual(SQL_LOG.length, 0, 'Object.prototype 属性不得触发任何 SQL')

  SQL_LOG.length = 0
  const sentRes = makeRes()
  await messageController.updateStatus({ body: { messageId: 12, status: 'sent' }, userId: 7 }, sentRes)
  check('P11 服务端态 sent 不允许客户端上报', () => {
    assert.strictEqual(sentRes.statusCode, 400)
    assert.strictEqual(SQL_LOG.length, 0)
  })

  // ================= P22 =================
  state = { liked: false }
  SQL_LOG.length = 0
  await postController.like({ params: { id: '55' }, userId: 7 }, makeRes())
  check('P22 首次点赞：INSERT IGNORE 且真插入才 +1', () => {
    assert.ok(SQL_LOG.some((q) => /INSERT IGNORE INTO forum_like/.test(q.sql)))
    assert.ok(SQL_LOG.some((q) => /SET like_count = like_count \+ 1/.test(q.sql)))
  })

  state = { liked: true }
  SQL_LOG.length = 0
  await postController.like({ params: { id: '55' }, userId: 7 }, makeRes())
  check('P22 取消点赞：DELETE 命中才扣计数', () => {
    assert.ok(SQL_LOG.some((q) => /DELETE FROM forum_like/.test(q.sql)))
    assert.ok(SQL_LOG.some((q) => /GREATEST\(like_count - 1, 0\)/.test(q.sql)))
    assert.ok(!SQL_LOG.some((q) => /like_count \+ 1/.test(q.sql)), '取消路径不得 +1')
  })

  // 并发双击：明细已存在（SELECT 命中）但走 else 分支时 INSERT IGNORE 影响 0 行 → 不得 +1
  state = { liked: false, forceIgnoreZero: true }
  const originalHandle = handle
  SQL_LOG.length = 0
  handle = function (text) {
    if (/^INSERT IGNORE INTO forum_like/.test(text)) return [{ affectedRows: 0 }]
    return originalHandle(text)
  }
  await postController.like({ params: { id: '55' }, userId: 7 }, makeRes())
  handle = originalHandle
  check('P22 并发重复点赞（IGNORE 影响 0 行）不再加计数', () => {
    assert.ok(SQL_LOG.some((q) => /INSERT IGNORE INTO forum_like/.test(q.sql)))
    assert.ok(!SQL_LOG.some((q) => /like_count \+ 1/.test(q.sql)), '重复点赞不得再 +1')
  })

  state = { followed: false }
  SQL_LOG.length = 0
  const followRes = makeRes()
  await postController.follow({ params: { id: '55' }, userId: 7 }, followRes)
  check('P22 蹲贴双写仍然有效（明细 + 计数 + 回读真实值）', () => {
    assert.ok(SQL_LOG.some((q) => /INSERT IGNORE INTO forum_post_follow/.test(q.sql)))
    assert.ok(SQL_LOG.some((q) => /SET follow_count = follow_count \+ 1/.test(q.sql)))
    assert.strictEqual(followRes.body.data.followed, true)
    assert.strictEqual(followRes.body.data.followCount, 2)
  })

  // ================= P19 =================
  state = {
    pollComponents: [
      { type: 'poll', question: '选哪个', mode: 'single', options: [{ text: 'A', votes: 0 }, { text: 'B', votes: 0 }], voterIds: [] },
    ],
    pollVoted: false,
  }
  SQL_LOG.length = 0
  const voteRes = makeRes()
  await postController.vote({ params: { id: '55' }, body: { optionIndexes: [0], pollIndex: 0 }, userId: 7 }, voteRes)
  check('P19 投票先写明细表再更新 JSON', () => {
    assert.strictEqual(voteRes.body.code, 200, JSON.stringify(voteRes.body))
    const insertIndex = SQL_LOG.findIndex((q) => /INSERT INTO forum_poll_vote/.test(q.sql))
    const updateIndex = SQL_LOG.findIndex((q) => /UPDATE forum_post SET components/.test(q.sql))
    assert.ok(insertIndex >= 0, '应写 forum_poll_vote')
    assert.ok(updateIndex > insertIndex, '明细先落库，再更新展示用 JSON')
    assert.deepStrictEqual(SQL_LOG[insertIndex].params, [55, 0, '0', 7])
  })

  state.pollVoted = true
  SQL_LOG.length = 0
  const dupRes = makeRes()
  await postController.vote({ params: { id: '55' }, body: { optionIndexes: [0], pollIndex: 0 }, userId: 7 }, dupRes)
  check('P19 唯一键冲突回「你已经投过票了」且不写 JSON', () => {
    assert.strictEqual(dupRes.statusCode, 400)
    assert.strictEqual(dupRes.body.message, '你已经投过票了')
    assert.ok(!SQL_LOG.some((q) => /UPDATE forum_post SET components/.test(q.sql)), '冲突后必须回滚，不改帖子')
    assert.ok(state.rolledBack, '事务应回滚')
  })

  console.log(`状态与计数修复回归通过 ${passed} 组断言。`)
}

main().catch((error) => {
  console.error('FAILED:', error && (error.stack || error.message))
  process.exit(1)
})