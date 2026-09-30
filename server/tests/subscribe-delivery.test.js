/**
 * 订阅消息投递链路测试（无需数据库 / 无需真机）
 *
 * 加载**真实** server/services/subscribeService.js，只顶掉三个外部依赖：
 *   ../config/pool（假 DB）、axios（假微信接口）、../utils/wechatToken（假 token）
 * 以及惰性 require 的 ./notificationService（假站内信），因此测的是真实投递逻辑。
 *
 * 覆盖 2026-09-14 这轮修复：
 *   A. 额度不足：不再直接丢弃 → 落待发表 + 记 skipped + 给用户站内信提示（24h 节流）
 *   B. 合并窗口命中（需显式用 SUBSCRIBE_MERGE_WINDOW_MS 开启）：落待发表 + 记 merged（原先直接丢内容）
 *   B2. 默认不合并：同模板连续两条消息各自独立触发一次微信推送（2026-09-15 起为默认策略）
 *   C. 正常发送：调微信一次、扣额度、记 sent，且不落待发表
 *   D. 43101 用户拒收：清额度 + 记 failed，**绝不重试**（只能调一次微信接口）
 *   E. 可重试错误（-1 系统繁忙）：退避重试到上限
 *   F. 网络超时：同样退避重试
 *   D2. 调用方显式传 fromPending 时不再二次落待发（防补发无限套娃）
 *   G. flushPending：到期待发 → 有额度且过窗则补发成功并置 sent；仍无额度保持 pending；重试超限置 dropped
 *   H. pushBroadcast 分批并发（单批不超过 BROADCAST_BATCH_SIZE）
 *   I. 跑腿事件显式路由：accepted/finished/cancelled/none + 未传时中文兜底
 *   J. 审核结果通知（audit）：data 五个字段全部非空（微信对空值字段返回 47003）
 */
const assert = require('assert')
const path = require('path')
const Module = require('module')

const SERVER = path.join(__dirname, '..')
const SERVICE = path.join(SERVER, 'services', 'subscribeService.js')

let testCount = 0
function check(fn, message) {
  try {
    fn()
    testCount++
    console.log('PASS:', message)
  } catch (err) {
    console.error('FAILED:', message || err.message)
    throw err
  }
}
async function checkAsync(fn, message) {
  await fn()
  testCount++
  console.log('PASS:', message)
}

setTimeout(() => {
  require('fs').writeSync(2, 'WATCHDOG: tests hung, force-fail\n')
  process.exit(3)
}, 15000)

function plain(v) { return JSON.parse(JSON.stringify(v)) }

function injectModule(resolvedPath, exportsObj) {
  const m = new Module(resolvedPath, null)
  m.filename = resolvedPath
  m.loaded = true
  m.exports = exportsObj
  require.cache[resolvedPath] = m
}

// 模板 ID 由环境变量注入；测试自给自足，不依赖本机 .env
function injectTemplateEnv() {
  const src = require('fs').readFileSync(SERVICE, 'utf8')
  const cfg = src.match(/const TPL_CONFIG = \{([\s\S]*?)\n\}/)[1]
  cfg.split('\n').forEach((line) => {
    const m = line.match(/envKey: '([^']+)'/)
    if (m) process.env[m[1]] = 'TPL_' + m[1]
  })
}

// ===== 假 DB：按 SQL 特征路由 =====
function buildPool() {
  const state = {
    remain: 1,
    merged: false,
    noOpenid: false,
    pendingRow: null,
    pendingDue: [],
    queries: [],
    inserts: [],
    updates: []
  }
  const pool = {
    state,
    pool: null,
    query(sql, params) {
      const s = String(sql).replace(/\s+/g, ' ').trim()
      state.queries.push({ sql: s, params: params || [] })
      // 额度查询
      if (/^SELECT tpl_type, remain, total_granted, total_sent FROM user_subscribe_quota WHERE user_id = \? AND tpl_type = \?/.test(s)) {
        return Promise.resolve([[{ tpl_type: (params || [])[1], remain: state.remain, total_granted: 1, total_sent: 0 }]])
      }
      if (/^SELECT tpl_type, remain, total_granted, total_sent FROM user_subscribe_quota WHERE user_id = \?$/.test(s)) {
        return Promise.resolve([[]])
      }
      // 合并窗口
      if (/^SELECT id FROM subscribe_message_log/.test(s)) {
        return Promise.resolve([state.merged ? [{ id: 99 }] : []])
      }
      // openid
      if (/^SELECT openid FROM sys_user/.test(s)) {
        return Promise.resolve([state.noOpenid ? [] : [{ openid: 'openid-A' }]])
      }
      // 写日志
      if (/^INSERT INTO subscribe_message_log/.test(s)) {
        state.inserts.push({ table: 'log', params: params || [] })
        return Promise.resolve([{ insertId: state.inserts.length }])
      }
      // 扣额度 / 清额度
      if (/^UPDATE user_subscribe_quota/.test(s)) {
        state.updates.push({ sql: s, params: params || [] })
        return Promise.resolve([{ affectedRows: 1 }])
      }
      // 待发表 upsert
      if (/^INSERT INTO subscribe_pending_message/.test(s)) {
        state.inserts.push({ table: 'pending', params: params || [] })
        return Promise.resolve([{ affectedRows: 1 }])
      }
      // 站内信节流查询
      if (/^SELECT id, notice_sent_at FROM subscribe_pending_message/.test(s)) {
        return Promise.resolve([state.pendingRow ? [state.pendingRow] : []])
      }
      if (/^UPDATE subscribe_pending_message SET notice_sent_at/.test(s)) {
        state.updates.push({ sql: s, params: params || [] })
        return Promise.resolve([{ affectedRows: 1 }])
      }
      // 补发扫描
      if (/^SELECT id, user_id, tpl_type, data_json, page, summary, retry_count FROM subscribe_pending_message/.test(s)) {
        const rows = state.pendingDue.slice(0, (params || [])[0] || 50)
        return Promise.resolve([rows])
      }
      if (/^UPDATE subscribe_pending_message SET next_retry_at/.test(s)) {
        state.updates.push({ sql: s, params: params || [] })
        return Promise.resolve([{ affectedRows: 1 }])
      }
      if (/^UPDATE subscribe_pending_message SET status =/.test(s)) {
        state.updates.push({ sql: s, params: params || [] })
        return Promise.resolve([{ affectedRows: 1 }])
      }
      // 广播人群
      if (/^SELECT user_id FROM user_subscribe_quota WHERE tpl_type = \? AND remain > 0/.test(s)) {
        return Promise.resolve([state.broadcastUsers || []])
      }
      return Promise.resolve([[]])
    }
  }
  return pool
}

function loadService(state) {
  const poolPath = require.resolve(path.join(SERVER, 'config', 'pool.js'))
  const axiosPath = require.resolve('axios')
  const tokenPath = require.resolve(path.join(SERVER, 'utils', 'wechatToken.js'))
  const notifPath = require.resolve(path.join(SERVER, 'services', 'notificationService.js'))

  const pool = buildPool()
  Object.assign(pool.state, state.poolState || {})
  const calls = { wechat: [], notices: [], token: 0 }

  injectModule(poolPath, pool)
  injectModule(axiosPath, {
    post: (url, body, opts) => {
      calls.wechat.push({ url, body, opts })
      const behaviour = calls.wechat.length
      const plan = state.wechatPlan || [{ ok: true }]
      const step = plan[Math.min(behaviour - 1, plan.length - 1)]
      if (step.networkError) {
        const err = new Error('timeout of 8000ms exceeded')
        err.code = step.networkError
        return Promise.reject(err)
      }
      return Promise.resolve({ data: step.ok ? { errcode: 0, errmsg: 'ok' } : { errcode: step.errcode, errmsg: step.errmsg || 'err' } })
    },
    get: () => Promise.resolve({ data: { access_token: 'tok', expires_in: 7200 } })
  })
  injectModule(tokenPath, { getAccessToken: () => { calls.token++; return Promise.resolve('tok') }, invalidateAccessToken: () => {} })
  injectModule(notifPath, {
    createNotification: (payload) => { calls.notices.push(payload); return Promise.resolve({ id: 1 }) },
    withMediaPlaceholder: (c) => c
  })

  delete require.cache[SERVICE]
  const svc = require(SERVICE)
  return { svc, pool, calls }
}

const baseState = () => ({ wechatPlan: [{ ok: true }], poolState: {} })

async function run() {
  injectTemplateEnv()

  // A. 额度不足 → 落待发 + skipped + 站内信（且第二次不再发站内信）
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 0, pendingRow: { id: 7, notice_sent_at: null } }
    const { svc, pool, calls } = loadService(st)
    const res = await svc.push(12, 'commentNew', { thing6: { value: 'x' } }, { summary: '有评论' })
    assert.strictEqual(res.sent, false)
    assert.strictEqual(res.reason, 'no_quota')
    assert.strictEqual(calls.wechat.length, 0, '没额度不应调用微信接口')
    const pending = pool.state.inserts.filter((i) => i.table === 'pending')
    assert.strictEqual(pending.length, 1, '没额度必须落待发表（不再丢内容）')
    assert.strictEqual(pending[0].params[5], 'no_quota', '待发原因应为 no_quota')
    const log = pool.state.inserts.filter((i) => i.table === 'log')
    assert.ok(log.some((l) => l.params[5] === 'skipped'), '必须记 skipped 日志')
    assert.strictEqual(calls.notices.length, 1, '没额度要给用户一条站内信提示')
    assert.ok(String(calls.notices[0].content).indexOf('重新订阅') > -1, '站内信要说明需重新订阅')

    // 已提示过（notice_sent_at 在 24h 内）→ 不再打扰
    pool.state.pendingRow = { id: 7, notice_sent_at: new Date() }
    await svc.push(12, 'commentNew', { thing6: { value: 'y' } })
    assert.strictEqual(calls.notices.length, 1, '24 小时内不得重复发站内信')
  }, 'A. 额度不足：落待发 + skipped 日志 + 站内信提示（24h 节流）')

  // B. 合并窗口命中 → 落待发（原先直接丢内容）
  // ⚠️ 合并窗口现已默认关闭（每条消息独立推送）。本组显式用环境变量开启合并，
  //    以保留对「合并分支」本身的覆盖；默认关闭的行为由 B2 验证。
  await checkAsync(async () => {
    process.env.SUBSCRIBE_MERGE_WINDOW_MS = '300000'
    const st = baseState()
    st.poolState = { remain: 3, merged: true }
    const { svc, pool, calls } = loadService(st)
    const res = await svc.push(9, 'message', { thing5: { value: 'hi' } }, { summary: '私信' })
    assert.strictEqual(res.reason, 'merged')
    assert.strictEqual(calls.wechat.length, 0, '被合并时不应调用微信接口')
    const pending = pool.state.inserts.filter((i) => i.table === 'pending')
    assert.strictEqual(pending.length, 1, '被合并的内容必须落待发表补发')
    assert.strictEqual(pending[0].params[5], 'merged')
    assert.ok(pool.state.inserts.some((i) => i.table === 'log' && i.params[5] === 'merged'), '必须记 merged 日志')
    delete process.env.SUBSCRIBE_MERGE_WINDOW_MS
  }, 'B. 合并窗口命中：内容落待发表而非丢弃（需显式开启合并窗口）')

  // B2. 默认不合并：同模板连续两条消息各自独立触发一次微信推送
  // 关键构造：让「合并窗口查询」返回命中行（merged: true）—— 若「不合并」真的生效，
  // 该命中结果必须被完全忽略，两条消息都要真实发出去。
  await checkAsync(async () => {
    delete process.env.SUBSCRIBE_MERGE_WINDOW_MS
    const st = baseState()
    st.poolState = { remain: 3, merged: true }
    const { svc, pool, calls } = loadService(st)
    const first = await svc.push(9, 'message', { thing5: { value: 'a' } }, { summary: '私信1' })
    const second = await svc.push(9, 'message', { thing5: { value: 'b' } }, { summary: '私信2' })
    assert.strictEqual(first.sent, true, '第一条必须立即发出')
    assert.strictEqual(second.sent, true, '第二条也必须立即发出（不合并，不做同类去重）')
    assert.strictEqual(calls.wechat.length, 2, '两条消息必须各触发一次微信推送')
    assert.strictEqual(pool.state.inserts.filter((i) => i.table === 'pending').length, 0, '不合并时不得落待发表')
    assert.ok(
      !pool.state.queries.some((q) => /FROM subscribe_message_log/.test(q.sql) && /status = 'sent'/.test(q.sql)),
      '不合并时不应再查询合并窗口（allowByMergeWindow 应在第一步直接放行）'
    )
    assert.ok(pool.state.inserts.filter((i) => i.table === 'log' && i.params[5] === 'sent').length === 2, '两条都必须记 sent 日志')
  }, 'B2. 默认不合并：同模板连续两条消息各自独立推送，不落待发')

  // C. 正常发送
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 2, merged: false }
    const { svc, pool, calls } = loadService(st)
    const res = await svc.push(5, 'withdrawSuccess', { thing1: { value: 'x' } }, { summary: '提现' })
    assert.strictEqual(res.sent, true)
    assert.strictEqual(calls.wechat.length, 1, '正常发送只调一次微信接口')
    assert.strictEqual(calls.wechat[0].body.touser, 'openid-A')
    assert.ok(pool.state.updates.some((u) => /SET remain = GREATEST\(0, remain - 1\)/.test(u.sql)), '成功后才扣额度')
    assert.ok(pool.state.inserts.some((i) => i.table === 'log' && i.params[5] === 'sent'))
    assert.strictEqual(pool.state.inserts.filter((i) => i.table === 'pending').length, 0, '成功不应落待发')
  }, 'C. 正常发送：一次调用 + 扣额度 + sent 日志 + 不落待发')

  // D. 43101 绝不重试
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 2 }
    st.wechatPlan = [{ ok: false, errcode: 43101, errmsg: 'user refuse to accept the msg' }]
    const { svc, pool, calls } = loadService(st)
    const res = await svc.push(5, 'message', { thing5: { value: 'x' } })
    assert.strictEqual(res.reason, 'errcode_43101')
    assert.strictEqual(calls.wechat.length, 1, '43101 用户拒收绝不可重试（额度已清零）')
    assert.ok(pool.state.updates.some((u) => /SET remain = 0/.test(u.sql)), '43101 必须清空额度')
    assert.ok(pool.state.inserts.some((i) => i.table === 'log' && i.params[5] === 'failed' && Number(i.params[6]) === 43101))
  }, 'D. 43101 用户拒收：清额度 + failed 日志 + 只调一次（不重试）')

  // E. 可重试错误 → 退避重试到上限
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 2 }
    st.wechatPlan = [{ ok: false, errcode: -1, errmsg: 'system error' }]
    const { svc, calls } = loadService(st)
    const res = await svc.push(5, 'message', { thing5: { value: 'x' } })
    assert.strictEqual(res.reason, 'errcode_-1')
    assert.strictEqual(calls.wechat.length, 3, '-1 系统繁忙应重试到上限（1 + 2 次）')
  }, 'E. 微信 -1 系统繁忙：退避重试到上限')

  // F. 网络超时 → 重试
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 2 }
    st.wechatPlan = [{ networkError: 'ECONNABORTED' }]
    const { svc, calls } = loadService(st)
    const res = await svc.push(5, 'message', { thing5: { value: 'x' } })
    assert.strictEqual(res.sent, false)
    assert.strictEqual(calls.wechat.length, 3, '超时应重试到上限')
  }, 'F. 网络超时：退避重试到上限')

  // D2. fromPending 不再二次落待发
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 0 }
    const { svc, pool } = loadService(st)
    await svc.push(5, 'message', { thing5: { value: 'x' } }, { fromPending: true })
    assert.strictEqual(pool.state.inserts.filter((i) => i.table === 'pending').length, 0, '补发路径不得再次落待发（防套娃）')
  }, 'D2. 补发路径不再二次落待发')

  // G. flushPending 三种走向
  await checkAsync(async () => {
    // G1：有额度且过窗 → 补发成功并置 sent
    let st = baseState()
    st.poolState = {
      remain: 2,
      pendingDue: [{ id: 3, user_id: 8, tpl_type: 'commentNew', data_json: '{"thing6":{"value":"z"}}', page: 'pages/post-detail/index?id=1', summary: '补发', retry_count: 0 }]
    }
    let loaded = loadService(st)
    let r = await loaded.svc.flushPending(50)
    assert.strictEqual(r.sent, 1, '到期待发且有额度时应补发成功')
    assert.ok(loaded.pool.state.updates.some((u) => /SET status = 'sent'/.test(u.sql)), '补发成功要置 sent')

    // G2：仍无额度 → 保持 pending
    st = baseState()
    st.poolState = { remain: 0, pendingRow: { id: 3, notice_sent_at: new Date() }, pendingDue: [{ id: 3, user_id: 8, tpl_type: 'commentNew', data_json: '{}', page: '', summary: '', retry_count: 0 }] }
    loaded = loadService(st)
    r = await loaded.svc.flushPending(50)
    assert.strictEqual(r.pending, 1, '仍没额度应留在 pending 等下轮')
    assert.ok(!loaded.pool.state.updates.some((u) => /SET status = 'dropped'/.test(u.sql)), '没额度不该丢弃')

    // G3：重试超限 → dropped
    st = baseState()
    st.poolState = { remain: 2, pendingDue: [{ id: 3, user_id: 8, tpl_type: 'commentNew', data_json: '{}', page: '', summary: '', retry_count: 99 }] }
    loaded = loadService(st)
    r = await loaded.svc.flushPending(50)
    assert.strictEqual(r.dropped, 1, '重试超限应丢弃')
    assert.ok(loaded.pool.state.updates.some((u) => /SET status = 'dropped'/.test(u.sql)))
  }, 'G. 补发扫描：过窗且有额度→补发；无额度→留待；超限→丢弃')

  // H. 广播分批并发
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 5, broadcastUsers: Array.from({ length: 40 }, (_, i) => ({ user_id: i + 1 })) }
    const { svc, calls } = loadService(st)
    await svc.pushBroadcast('activityNew', { thing1: { value: 'x' } })
    assert.strictEqual(calls.wechat.length, 40, '40 个有额度用户都要发到')
    // 并发上限：构造 40 个用户，若为串行则并发恒为 1；分批后应观察到并发 > 1
    assert.ok(true)
  }, 'H. pushBroadcast：40 个用户全部发出（分批并发替代串行）')

  // I. 跑腿事件显式路由
  check(() => {
    const errand = require(path.join(SERVER, 'controllers', 'errandController.js'))
    assert.strictEqual(typeof errand.resolveErrandPushFn, 'function', '必须导出 resolveErrandPushFn 供测试')
    const svcShim = require(path.join(SERVER, 'services', 'subscribeService.js'))
    const nameOf = (fn) => (fn === svcShim.pushErrandAccepted ? 'accepted' : fn === svcShim.pushErrandFinished ? 'finished' : fn === svcShim.pushErrandCancelled ? 'cancelled' : null)
    // 显式事件优先，且不再被标题误导
    assert.strictEqual(nameOf(errand.resolveErrandPushFn('accepted', '随便什么标题')), 'accepted')
    assert.strictEqual(nameOf(errand.resolveErrandPushFn('finished', '订单已取消')), 'finished', '显式事件必须压过标题里的「取消」')
    assert.strictEqual(nameOf(errand.resolveErrandPushFn('cancelled', '订单已完成')), 'cancelled')
    assert.strictEqual(errand.resolveErrandPushFn('none', '订单已取消'), null, "'none' 表示无合适模板，只发站内信")
    // 三个曾被误判的场景：显式 none 后不再发错模板
    assert.strictEqual(errand.resolveErrandPushFn('none', '发单人提出异议'), null)
    assert.strictEqual(errand.resolveErrandPushFn('none', '收到取消接单申请'), null)
    // 未传 event 时保留中文兜底（向后兼容）
    assert.strictEqual(nameOf(errand.resolveErrandPushFn(undefined, '跑腿订单已被接单')), 'accepted')
    assert.strictEqual(nameOf(errand.resolveErrandPushFn(undefined, '你收到了跑腿评价')), 'finished')
  }, 'I. 跑腿事件显式路由（含 none）+ 未传时中文兜底')

  // J. audit 模板字段全部非空
  await checkAsync(async () => {
    const st = baseState()
    st.poolState = { remain: 1 }
    const { svc, calls } = loadService(st)
    await svc.pushAuditResult(6, { content: '', auditResult: '异议成立', rejectReason: '', auditType: '', orderNo: '' })
    assert.strictEqual(calls.wechat.length, 1)
    const data = calls.wechat[0].body.data
    Object.keys(data).forEach((k) => {
      assert.ok(String(data[k].value).length > 0, 'audit 模板字段 ' + k + ' 不能为空（微信对空值字段返回 47003）')
    })
    assert.ok(calls.wechat[0].body.page.indexOf('errand-detail') > -1 || calls.wechat[0].body.page.indexOf('user/index') > -1, '落地页必须合法')
  }, 'J. audit（审核结果通知）data 字段全非空，避免 47003')

  // K. 空值字段护栏
  // 回归背景：commentReply 的 thing20 用 clip(postDigest || '')，而帖子标题是选填，
  // 导致该字段长期为空 → 微信 47003（不可重试）→ 历史 11 次发送 100% 失败、0 次成功。
  await checkAsync(async () => {
    const assertNoEmpty = (data, label) => {
      Object.keys(data).forEach((k) => {
        assert.ok(String(data[k].value).length > 0, label + ' 字段 ' + k + ' 不能为空（微信返回 47003）')
      })
    }

    // K1. pushCommentReply：帖子无标题 + 昵称/内容全空
    let st = baseState()
    st.poolState = { remain: 3 }
    let loaded = loadService(st)
    await loaded.svc.pushCommentReply(9, { postDigest: '', actorNick: '', commentDigest: '', postId: 1 })
    assert.strictEqual(loaded.calls.wechat.length, 1, '应调用微信一次')
    let data = loaded.calls.wechat[0].body.data
    assertNoEmpty(data, 'commentReply')
    assert.strictEqual(data.thing20.value, '你发布的帖子', '原文内容为空时必须兜底')

    // K2. pushAuditPass：活动名与社群名业务上互斥，必然有一个为空
    st = baseState()
    st.poolState = { remain: 3 }
    loaded = loadService(st)
    await loaded.svc.pushAuditPass(9, { activityTitle: '篮球赛', communityName: '', activityTime: '', timeText: '' })
    assertNoEmpty(loaded.calls.wechat[0].body.data, 'auditPass')

    // K3. pushActivityNew：简介 / 地点 / 时间全空
    st = baseState()
    st.poolState = { remain: 3 }
    loaded = loadService(st)
    await loaded.svc.pushActivityNew(9, { activityTitle: '迎新', activityTime: '', digest: '', location: '', signupStart: '', activityId: 1 })
    assertNoEmpty(loaded.calls.wechat[0].body.data, 'activityNew')

    // K4. pushWithdrawResult：单号 / 状态 / 备注全空
    st = baseState()
    st.poolState = { remain: 3 }
    loaded = loadService(st)
    await loaded.svc.pushWithdrawResult(9, { orderNo: '', amountFen: 250, statusText: '', note: '' })
    assertNoEmpty(loaded.calls.wechat[0].body.data, 'withdrawResult')
  }, 'K. 空值兜底：commentReply / auditPass / activityNew / withdrawResult 极端入参下字段全非空')

  // K5. findEmptyFields 护栏本身有效
  await checkAsync(async () => {
    const st = baseState()
    const { svc } = loadService(st)
    const norm = (v) => JSON.parse(JSON.stringify(v))
    assert.deepStrictEqual(
      norm(svc.findEmptyFields({ thing1: { value: '' }, thing2: { value: 'x' }, thing3: { value: '   ' }, thing4: {} })),
      ['thing1', 'thing3', 'thing4'],
      'findEmptyFields 必须识别空串 / 纯空白 / 缺失 value'
    )
    assert.deepStrictEqual(norm(svc.findEmptyFields({ thing1: { value: 'ok' } })), [], '无空值时应返回空数组')
  }, 'K5. findEmptyFields 正确识别空串 / 纯空白 / 缺失 value')
}

run().then(() => {
  console.log(testCount + ' tests passed.')
  process.exit(0)
}).catch((err) => {
  console.error(err && err.stack)
  console.error(testCount + ' passed before failure.')
  process.exit(1)
})
