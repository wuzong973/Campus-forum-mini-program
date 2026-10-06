const pool = require('../config/pool')
const { success, fail, permissionsFor } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')
const { createNotification } = require('../services/notificationService')
const subscribeService = require('../services/subscribeService')
const paymentController = require('./paymentController')

const ADMIN_ROLES = ['super_admin', 'content_admin', 'user_admin', 'operator']
const CONTENT_TYPES = ['category', 'tag', 'notice', 'banner', 'publish_banner', 'message_banner', 'post_banner', 'service_page_campus_card']
const POST_STATUS = [0, 1, 2, 3]

function pageParams(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const pageSize = clampPageSize(query.pageSize, 50)
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function intId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : 0
}

function bool(value) {
  return Number(value) ? 1 : 0
}

function optionalText(value, max) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length > max) return null
  return value.trim()
}

async function audit(req, action, targetType, targetId, detail) {
  try {
    await writeAdminAudit(req, action, targetType, targetId, detail)
  } catch (e) {
    // Management data must remain usable if the separate audit table is unavailable.
    console.error('[admin-audit]', e.message)
  }
}

exports.me = async (req, res) => {
  success(res, { id: req.user.id, role: req.user.role, permissions: permissionsFor(req.user.role) })
}

// 单条统计查询失败只影响对应指标，不让整个概览接口 500
async function statOne(sql) {
  try {
    const [rows] = await pool.query(sql)
    return rows && rows[0] ? rows[0] : {}
  } catch (e) {
    console.error('[admin-stats]', e.message)
    return {}
  }
}

const num = (v) => Number(v || 0)

// 「我的」页管理后台入口角标：汇总所有需要管理员审核/处理的未处理数量。
// 各业务一张小 COUNT，合并一次返回；入口页轮询这个接口即可实时反映数量变化。
exports.pendingCount = async (req, res) => {
  try {
    const [reports, posts, activities, chatApplies, clubApplies, withdrawals, riders] = await Promise.all([
      pool.query("SELECT COUNT(*) n FROM content_report WHERE status = 'pending'").then(([r]) => num(r[0].n)),
      pool.query('SELECT COUNT(*) n FROM forum_post WHERE status = 2').then(([r]) => num(r[0].n)),
      pool.query("SELECT COUNT(*) n FROM campus_activity WHERE deleted = 0 AND audit_status = 'pending'").then(([r]) => num(r[0].n)),
      pool.query("SELECT COUNT(*) n FROM group_chat_apply WHERE status = 'pending'").then(([r]) => num(r[0].n)),
      pool.query("SELECT COUNT(*) n FROM club_apply WHERE status = 'pending'").then(([r]) => num(r[0].n)),
      pool.query("SELECT COUNT(*) n FROM wallet_withdrawal WHERE status = 'PENDING'").then(([r]) => num(r[0].n)),
      pool.query("SELECT COUNT(*) n FROM rider_verification WHERE status = 'pending'").then(([r]) => num(r[0].n))
    ])
    const breakdown = { reports, posts, activities, chatApplies, clubApplies, withdrawals, riders }
    const total = Object.keys(breakdown).reduce((sum, k) => sum + breakdown[k], 0)
    success(res, { total, breakdown })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.stats = async (req, res) => {
  try {
    const [users, posts, errands, items, activity, recentRows] = await Promise.all([
      statOne('SELECT COUNT(*) total, IFNULL(SUM(status = 1), 0) enabled FROM sys_user'),
      statOne('SELECT COUNT(*) total, IFNULL(SUM(status = 1), 0) published, IFNULL(SUM(status = 2), 0) pending, IFNULL(SUM(status = 3), 0) hidden FROM forum_post'),
      statOne("SELECT COUNT(*) total, SUM(status = 'finished') finished, IFNULL(SUM(CASE WHEN status = 'finished' THEN reward ELSE 0 END), 0) amount FROM errand_order"),
      statOne('SELECT COUNT(*) total, IFNULL(SUM(status = 1), 0) online FROM virtual_item'),
      statOne('SELECT COUNT(*) posts7d, COUNT(DISTINCT user_id) activeUsers7d FROM forum_post WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
      pool.query('SELECT l.action, l.target_type targetType, l.target_id targetId, l.created_at createdAt, u.nick_name adminName FROM admin_audit_log l LEFT JOIN sys_user u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 8').then(([rows]) => rows).catch(() => [])
    ])
    success(res, {
      users: { total: num(users.total), enabled: num(users.enabled), active7d: num(activity.activeUsers7d) },
      posts: { total: num(posts.total), published: num(posts.published), pending: num(posts.pending), hidden: num(posts.hidden), published7d: num(activity.posts7d) },
      errands: { total: num(errands.total), finished: num(errands.finished), amount: num(errands.amount) },
      items: { total: num(items.total), online: num(items.online) },
      recentActions: recentRows,
      generatedAt: new Date().toISOString()
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listReports = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '').trim()
  const allowed = ['', 'pending', 'processing', 'resolved', 'rejected']
  if (!allowed.includes(status)) return fail(res, 'Invalid report status')
  const params = []
  const where = status ? 'WHERE r.status = ?' : ''
  if (status) params.push(status)
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM content_report r ${where}`, params),
      pool.query(`SELECT r.id, r.reporter_id reporterId, r.target_type targetType, r.target_id targetId, r.reason, r.status, r.handled_note handledNote, r.created_at createdAt, u.nick_name reporterName FROM content_report r LEFT JOIN sys_user u ON u.id = r.reporter_id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    success(res, { list, total: Number(count[0].total || 0), page, hasMore: offset + list.length < Number(count[0].total || 0) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateReport = async (req, res) => {
  const id = intId(req.params.id)
  const status = String((req.body || {}).status || '').trim()
  const note = optionalText((req.body || {}).note, 500)
  if (!id || !['processing', 'resolved', 'rejected'].includes(status) || note === null) return fail(res, 'Invalid report update')
  try {
    const [result] = await pool.query('UPDATE content_report SET status = ?, handled_by = ?, handled_note = ?, handled_at = NOW() WHERE id = ?', [status, req.userId, note || '', id])
    if (!result.affectedRows) return fail(res, 'Report not found', 404)
    await audit(req, 'report.update', 'content_report', id, { status, note: note || '' })
    success(res, { id, status })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listPosts = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = req.query.status === '' || req.query.status === undefined ? null : Number(req.query.status)
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  if (status !== null && !POST_STATUS.includes(status)) return fail(res, 'Invalid post status')
  try {
    let where = 'WHERE 1 = 1'
    const params = []
    if (status !== null) { where += ' AND p.status = ?'; params.push(status) }
    if (keyword) { where += ' AND (p.title LIKE ? OR p.content LIKE ? OR u.nick_name LIKE ?)'; const q = '%' + keyword + '%'; params.push(q, q, q) }
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM forum_post p LEFT JOIN sys_user u ON u.id = p.user_id ${where}`, params),
      pool.query(`SELECT p.id, p.user_id userId, p.title, p.category, p.content, p.status, p.pinned, p.review_note reviewNote, p.created_at createdAt, p.updated_at updatedAt, p.like_count likeCount, p.comment_count commentCount, u.nick_name nickName, u.avatar_url avatarUrl FROM forum_post p LEFT JOIN sys_user u ON u.id = p.user_id ${where} ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    success(res, { list, total: Number(count[0].total), page, hasMore: offset + list.length < Number(count[0].total) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 跑腿订单流程（管理后台「日志」tab）：展示 xx 发布订单、xx 接单等全流程 =====
const CANCEL_LOG_ACTIONS = ['cancelled', 'timeout_cancelled', 'deadline_cancelled', 'self_cancel', 'cancel_approved']

exports.listErrandOrders = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '')
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  let where = 'WHERE 1 = 1'
  const params = []
  // 「进行中」同时覆盖 accepted 与 finishing（接单方已提交完成、等待发单人确认）
  if (status === 'accepted') { where += " AND e.status IN ('accepted', 'finishing')" }
  else if (['pending', 'finishing', 'finished', 'cancelled', 'disputed'].includes(status)) { where += ' AND e.status = ?'; params.push(status) }
  if (keyword) {
    where += ' AND (e.title LIKE ? OR p.nick_name LIKE ? OR a.nick_name LIKE ?' + (/^\d+$/.test(keyword) ? ' OR e.id = ?' : '') + ')'
    const q = '%' + keyword + '%'
    params.push(q, q, q)
    if (/^\d+$/.test(keyword)) params.push(Number(keyword))
  }
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM errand_order e LEFT JOIN sys_user p ON e.publisher_id = p.id LEFT JOIN sys_user a ON e.acceptor_id = a.id ${where}`, params),
      pool.query(`SELECT e.id, e.title, e.reward, e.status, e.payment_status paymentStatus, e.created_at createdAt, e.accepted_at acceptedAt, e.finished_at finishedAt,
        e.dispute_reason disputeReason, e.disputed_at disputedAt, e.dispute_result disputeResult,
        p.nick_name publisherName, p.phone publisherPhone, p.avatar_url publisherAvatar,
        a.nick_name acceptorName, a.phone acceptorPhone, a.avatar_url acceptorAvatar,
        (SELECT l.detail FROM errand_order_log l WHERE l.order_id = e.id ORDER BY l.created_at DESC, l.id DESC LIMIT 1) lastDetail,
        (SELECT l.created_at FROM errand_order_log l WHERE l.order_id = e.id ORDER BY l.created_at DESC, l.id DESC LIMIT 1) lastAt
       FROM errand_order e LEFT JOIN sys_user p ON e.publisher_id = p.id LEFT JOIN sys_user a ON e.acceptor_id = a.id
       ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    success(res, { list, total: Number(count[0].total), page, hasMore: offset + list.length < Number(count[0].total) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 跑腿接单完成率 / 冻结名单（管理后台）
//
// 冻结口径与 errandController.freezeStats 完全一致：total >= 3 且 finished/total < 0.5，
// 且 frozen_until 仍在未来（到期自动恢复）。这里必须把「已完成/自身取消/完成率/冻结到期」
// 一起给出来 —— 只看一个布尔值，管理员无法判断该不该解冻。
exports.listErrandRunners = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  const only = String(req.query.only || '')  // 'frozen' = 只看被冻结的
  let where = 'WHERE 1 = 1'
  const params = []
  if (keyword) {
    where += ' AND (u.nick_name LIKE ? OR u.phone LIKE ?' + (/^\d+$/.test(keyword) ? ' OR s.user_id = ?' : '') + ')'
    const q = '%' + keyword + '%'
    params.push(q, q)
    if (/^\d+$/.test(keyword)) params.push(Number(keyword))
  }
  if (only === 'frozen') {
    where += ' AND s.finished_count + s.self_cancel_count >= 3'
    where += ' AND s.finished_count / (s.finished_count + s.self_cancel_count) < 0.5'
    where += ' AND s.frozen_until IS NOT NULL AND s.frozen_until > NOW()'
  }
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM errand_stat s LEFT JOIN sys_user u ON s.user_id = u.id ${where}`, params),
      pool.query(`SELECT s.user_id userId, s.finished_count finishedCount, s.self_cancel_count selfCancelCount,
          s.frozen_at frozenAt, s.frozen_until frozenUntil, s.unfrozen_at unfrozenAt, s.unfreeze_note unfreezeNote,
          s.updated_at updatedAt, u.nick_name nickName, u.phone, u.avatar_url avatarUrl, u.status userStatus
         FROM errand_stat s LEFT JOIN sys_user u ON s.user_id = u.id
         ${where} ORDER BY s.self_cancel_count DESC, s.user_id ASC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    const FREEZE_MIN_RECORDS = 3
    const FREEZE_RATE = 0.5
    const rows = list.map((r) => {
      const finished = Number(r.finishedCount) || 0
      const selfCancel = Number(r.selfCancelCount) || 0
      const total = finished + selfCancel
      const rate = total ? finished / total : 1
      const overThreshold = total >= FREEZE_MIN_RECORDS && rate < FREEZE_RATE
      const until = r.frozenUntil ? new Date(r.frozenUntil).getTime() : 0
      const frozen = overThreshold && until > Date.now()
      // 已解冻 = 统计上仍超标（完成率没变好），但冻结期已被提前结束（frozen_until 在过去）。
      // 必须单独标出来：否则端上只能靠 overThreshold 判，会把「已解冻」误显示成「待解冻」，
      // 还会给出一个点了没用的「恢复接单」按钮（2026-10-06 实测）。
      const unfrozen = overThreshold && !frozen && !!r.frozenUntil
      return Object.assign({}, r, {
        totalCount: total,
        finishRate: Math.round(rate * 1000) / 10,
        overThreshold,
        frozen,
        unfrozen
      })
    })
    success(res, { list: rows, total: Number(count[0].total), page, hasMore: offset + rows.length < Number(count[0].total) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 手动解除接单冻结（客服人工放行）
//
// 为什么需要：完成率低到阈值后，接单接口直接 403 → finished_count 不再增长 →
// 完成率永远低于阈值。不提供手动解冻，「冻结」在数学上就是永久封禁。
// 解冻只写 frozen_until = NOW()（对完成率本身不做粉饰，统计仍如实保留）。
exports.unfreezeErrandRunner = async (req, res) => {
  const userId = intId(req.params.userId)
  const note = optionalText((req.body && req.body.note) || '', 255)
  if (!userId || note === null) return fail(res, 'Invalid user id')
  try {
    const [rows] = await pool.query('SELECT * FROM errand_stat WHERE user_id = ?', [userId])
    if (!rows.length) return fail(res, '该用户没有接单记录', 404)
    await pool.query(
      'UPDATE errand_stat SET frozen_until = NOW(), unfrozen_at = NOW(), unfreeze_note = ? WHERE user_id = ?',
      [note || '', userId]
    )
    const [after] = await pool.query('SELECT * FROM errand_stat WHERE user_id = ?', [userId])
    success(res, { runner: after[0] }, '已解除接单冻结')
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.errandOrderDetail = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid order id')
  try {
    const [[order]] = await pool.query(`SELECT e.*, p.nick_name publisherName, p.phone publisherPhone, p.avatar_url publisherAvatar,
      a.nick_name acceptorName, a.phone acceptorPhone, a.avatar_url acceptorAvatar
      FROM errand_order e LEFT JOIN sys_user p ON e.publisher_id = p.id LEFT JOIN sys_user a ON e.acceptor_id = a.id
      WHERE e.id = ?`, [id])
    if (!order) return fail(res, '订单不存在', 404)
    const [logs] = await pool.query(`SELECT l.id, l.action, l.detail, l.created_at createdAt, l.actor_id actorId, u.nick_name actorName
      FROM errand_order_log l LEFT JOIN sys_user u ON u.id = l.actor_id
      WHERE l.order_id = ? ORDER BY l.created_at ASC, l.id ASC`, [id])
    // 取消时间：取取消类流水的最后一条（发单取消/超时取消/截止取消/接单方取消/审批取消）
    let cancelledAt = null
    for (const log of logs) {
      if (CANCEL_LOG_ACTIONS.includes(log.action)) cancelledAt = log.createdAt
    }
    success(res, { order, logs, cancelledAt })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

async function notifyUser(userId, title, content, relatedId) {
  if (!userId) return
  try {
    await createNotification({ userId, type: 'errand', title, content, relatedId })
  } catch (e) {
    console.error('[ErrandDisputeNotify]', safeMessage(e))
  }
}

// 异议裁决结果 → 微信订阅消息（「审核结果通知」模板 audit）。
//
// 这是 audit 模板唯一的真实业务触点：客服对跑腿订单异议的裁决，本质就是一次
// 「订单异议裁决」，模板自带订单号字段，与场景完全对应（此前该模板只在设置页有开关，
// 服务端从未调用过 —— 用户开了也永远收不到）。
//
// 所有 data 字段必须落非空值：微信对空值字段直接返回 47003，且该错误不可重试。
function notifyDisputeSubscribe(order, action, note) {
  if (!order) return
  const approved = action === 'approve'
  const data = {
    content: order.title || ('跑腿订单 #' + order.id),
    // phrase 类型上限 5 个字
    auditResult: approved ? '异议成立' : '异议不成立',
    rejectReason: String(note || '').trim() || (approved
      ? '客服核实异议成立，订单已取消并原路退款'
      : '客服核实异议不成立，订单已完成并结算'),
    auditType: '订单异议裁决',
    orderNo: order.order_no || String(order.id),
    orderId: order.id
  }
  // 发单人与接单人都要收到裁决结果
  ;[order.publisher_id, order.acceptor_id].forEach((uid) => {
    if (!uid) return
    subscribeService.pushAuditResult(uid, data).catch(() => {})
  })
}

// ===== 订阅消息发送流水（管理后台「日志 → 订阅消息」）=====
// 客服排查「用户反馈收不到微信通知」时直接看这里，不必连库。状态语义：
//   sent      已成功交给微信 —— 之后的到达时间由微信决定，服务端不可观测
//   merged    合并窗口内已发过同类消息（现已转入待发补发，不再直接丢弃）
//   skipped   额度不足（用户没授权过，或授权次数已用尽）
//   failed    发送失败，看 errcode：43101 用户拒收 / 47003 模板字段不符 / 40003 openid 无效
//   throttled 命中弹窗节流：客户端判定「该触发组今天已弹满 3 次」而**没有调用微信**。
//             这是唯一由客户端上报写入的状态（节流判定在 tap 同步链内，服务端无法感知）
exports.listSubscribeLogs = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '').trim()
  const tplType = String(req.query.tplType || '').trim().slice(0, 24)
  const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  let where = 'WHERE 1 = 1'
  const params = []
  if (['sent', 'merged', 'skipped', 'failed', 'throttled'].includes(status)) { where += ' AND l.status = ?'; params.push(status) }
  if (tplType) { where += ' AND l.tpl_type = ?'; params.push(tplType) }
  if (keyword) {
    where += ' AND (u.nick_name LIKE ? OR l.summary LIKE ?' + (/^\d+$/.test(keyword) ? ' OR l.user_id = ?' : '') + ')'
    const q = '%' + keyword + '%'
    params.push(q, q)
    if (/^\d+$/.test(keyword)) params.push(Number(keyword))
  }
  try {
    const [[count], [list], [quota], [pending]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM subscribe_message_log l LEFT JOIN sys_user u ON u.id = l.user_id ${where}`, params),
      pool.query(
        `SELECT l.id, l.user_id userId, l.tpl_type tplType, l.status, l.errcode, l.errmsg,
                l.page, l.summary, l.created_at createdAt, u.nick_name userName
         FROM subscribe_message_log l LEFT JOIN sys_user u ON u.id = l.user_id
         ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      ),
      // 额度概览：一眼看出「是不是没额度了」
      //   users         = user_subscribe_quota 里有该模板记录的用户数（**包含已经用光的**，仅表示「授权过」）
      //   availableUsers= 其中 remain > 0、真正还能收的用户数
      //   remain        = 全体用户剩余额度之和（是总量，不是人均 —— 所以会出现「总量还有 30 条，
      //                   但某几个用户连续 skipped」的情况，那几个人只是自己用光了）
      //   sent          = 累计已发送条数
      pool.query(
        'SELECT tpl_type tplType, COUNT(DISTINCT user_id) users, SUM(remain > 0) availableUsers, SUM(remain) remain, SUM(total_sent) sent FROM user_subscribe_quota GROUP BY tpl_type ORDER BY tpl_type'
      ),
      // 待补发条数：有值说明有消息正等着窗口过期或额度恢复
      pool.query("SELECT COUNT(*) total FROM subscribe_pending_message WHERE status = 'pending'")
    ])
    success(res, {
      // 中文标签一律由服务端下发（subscribeService 的 TPL_CONFIG 是唯一真源），
      // 客户端不要再抄一份映射表，否则新增模板时两边会漂移。
      list: list.map((row) => Object.assign({}, row, { tplLabel: subscribeService.labelOf(row.tplType) })),
      total: Number(count[0].total),
      page,
      hasMore: offset + list.length < Number(count[0].total),
      quota: quota.map((row) => Object.assign({}, row, { label: subscribeService.labelOf(row.tplType) })),
      pendingTotal: Number(pending[0].total)
    })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 管理员裁决议异订单：
//   approve（通过）= 异议成立 → 订单取消，赏金按原支付路径退回发单人；
//   reject（拒绝）= 异议不成立 → 订单成立并显示已完成，赏金自动转入接单方钱包。
exports.reviewErrandDispute = async (req, res) => {
  const id = intId(req.params.id)
  const body = req.body || {}
  const action = String(body.action || '').trim()
  const note = optionalText(body.note || '', 255)
  if (!id || !['approve', 'reject'].includes(action) || note === null) return fail(res, 'Invalid review action')
  let order = null
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT * FROM errand_order WHERE id = ? FOR UPDATE', [id])
    order = rows[0]
    if (!order) { await conn.rollback(); return fail(res, '订单不存在', 404) }
    if (order.status !== 'disputed') { await conn.rollback(); return fail(res, '该订单不在异议处理中，请勿重复操作', 409) }
    const result = action === 'approve' ? 'refunded' : 'completed'
    if (action === 'approve') {
      await conn.query(
        "UPDATE errand_order SET status = 'cancelled', dispute_result = ?, dispute_note = ?, dispute_handled_at = NOW() WHERE id = ? AND status = 'disputed'",
        [result, note || '', id]
      )
      await conn.query(
        'INSERT INTO errand_order_log (order_id, actor_id, action, detail) VALUES (?, ?, ?, ?)',
        [id, req.userId, 'dispute_approved', `客服判定异议成立，订单取消，赏金原路退回发单人${note ? '（' + note + '）' : ''}`]
      )
    } else {
      await conn.query(
        "UPDATE errand_order SET status = 'finished', finished_at = NOW(), confirmed_at = NOW(), dispute_result = ?, dispute_note = ?, dispute_handled_at = NOW() WHERE id = ? AND status = 'disputed'",
        [result, note || '', id]
      )
      // 订单成立：完成率与赏金结算口径与发单人主动确认完成保持一致
      if (order.acceptor_id) {
        await conn.query(
          'INSERT INTO errand_stat (user_id, finished_count) VALUES (?, 1) ON DUPLICATE KEY UPDATE finished_count = finished_count + 1',
          [order.acceptor_id]
        )
        if (order.payment_status === 'SUCCESS') {
          await conn.query(
            "INSERT IGNORE INTO wallet_ledger (user_id, entry_type, amount_fen, reference_type, reference_id, title) VALUES (?, 'ERRAND_EARNING', ?, 'errand_order', ?, ?)",
            [order.acceptor_id, Math.round(Number(order.reward) * 100), order.id, `Errand income #${order.id}`]
          )
        }
      }
      await conn.query(
        'INSERT INTO errand_order_log (order_id, actor_id, action, detail) VALUES (?, ?, ?, ?)',
        [id, req.userId, 'dispute_rejected', `客服驳回异议，订单成立并完成，赏金转入接单方钱包${note ? '（' + note + '）' : ''}`]
      )
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    return fail(res, safeMessage(e), 500)
  } finally {
    conn.release()
  }
  // 异议成立：订单已置 cancelled，复用既有退款链路把赏金原路退回发单人支付账户（幂等，失败可由对账任务重试）
  let refundStatus = null
  if (action === 'approve') {
    try {
      const refunded = await paymentController.cancelErrandAndRefund(id)
      refundStatus = (refunded && refunded.refund && refunded.refund.status) || null
    } catch (e) {
      console.error('[ErrandDisputeRefund]', safeMessage(e))
      refundStatus = 'FAILED'
    }
  }
  if (action === 'approve') {
    await notifyUser(order.publisher_id, '异议已处理：订单取消', `“${order.title}”经客服核实异议成立，订单已取消，赏金将原路退回你的支付账户`, id)
    await notifyUser(order.acceptor_id, '异议处理结果：订单取消', `“${order.title}”发单人的异议经客服核实成立，订单已取消`, id)
  } else {
    await notifyUser(order.publisher_id, '异议已处理：订单成立', `“${order.title}”的异议经客服核实不成立，订单已完成`, id)
    await notifyUser(order.acceptor_id, '异议处理结果：订单成立', `“${order.title}”发单人的异议被驳回，订单已完成，赏金已转入你的钱包`, id)
  }
  // 站内信之外补一条微信订阅提醒（「审核结果通知」模板）；不 await，不阻塞管理端响应
  notifyDisputeSubscribe(order, action, note)
  await audit(req, 'errand_dispute.' + action, 'errand_order', id, { note: note || '', refundStatus })
  success(res, { status: action === 'approve' ? 'refunded' : 'completed', refundStatus },
    action === 'approve' ? '已通过异议，订单取消并原路退款' : '已驳回异议，订单成立并结算给接单方')
}

exports.updatePost = async (req, res) => {
  const id = intId(req.params.id)
  const body = req.body || {}
  if (!id) return fail(res, 'Invalid post id')
  const title = optionalText(body.title, 128)
  const content = optionalText(body.content, 10000)
  const category = optionalText(body.category, 32)
  if (title === null || content === null || category === null || (content !== undefined && !content)) return fail(res, 'Invalid post content')
  const fields = []; const values = []
  if (title !== undefined) { fields.push('title = ?'); values.push(title) }
  if (content !== undefined) { fields.push('content = ?'); values.push(content) }
  if (category !== undefined) { fields.push('category = ?'); values.push(category) }
  if (!fields.length) return fail(res, 'No changes supplied')
  try {
    const [result] = await pool.query(`UPDATE forum_post SET ${fields.join(', ')} WHERE id = ?`, values.concat(id))
    if (!result.affectedRows) return fail(res, 'Post not found', 404)
    await audit(req, 'post.edit', 'post', id, { fields: Object.keys(body).filter((key) => ['title', 'content', 'category'].includes(key)) })
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.postAction = async (req, res) => {
  const id = intId(req.params.id)
  const action = String((req.body || {}).action || '')
  const actions = { approve: ['status = 1', []], delete: ['status = 0, pinned = 0', []], hide: ['status = 3, pinned = 0', []], pin: ['pinned = 1', []], unpin: ['pinned = 0', []] }
  if (!id || !actions[action]) return fail(res, 'Invalid management action')
  try {
    const [result] = await pool.query(`UPDATE forum_post SET ${actions[action][0]} WHERE id = ?`, [id])
    if (!result.affectedRows) return fail(res, 'Post not found', 404)
    await audit(req, 'post.' + action, 'post', id, {})
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.batchPostAction = async (req, res) => {
  const ids = Array.from(new Set(((req.body || {}).ids || []).map(intId).filter(Boolean))).slice(0, 100)
  const action = String((req.body || {}).action || '')
  const setByAction = { approve: 'status = 1', delete: 'status = 0, pinned = 0', hide: 'status = 3, pinned = 0', pin: 'pinned = 1', unpin: 'pinned = 0' }
  if (!ids.length || !setByAction[action]) return fail(res, 'Select 1 to 100 posts and a valid action')
  try {
    const marks = ids.map(() => '?').join(',')
    const [result] = await pool.query(`UPDATE forum_post SET ${setByAction[action]} WHERE id IN (${marks})`, ids)
    await audit(req, 'post.batch.' + action, 'post', ids.join(','), { count: result.affectedRows })
    success(res, { affected: result.affectedRows })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listContent = async (req, res) => {
  const type = String(req.query.type || '')
  if (type && !CONTENT_TYPES.includes(type)) return fail(res, 'Invalid content type')
  try {
    const [list] = await pool.query(`SELECT id, type, title, body, status, sort_order sortOrder, updated_at updatedAt FROM system_content ${type ? 'WHERE type = ?' : ''} ORDER BY type, sort_order, id DESC`, type ? [type] : [])
    success(res, { list })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.createContent = async (req, res) => {
  const body = req.body || {}; const type = String(body.type || ''); const title = optionalText(body.title, 128); const text = optionalText(body.body || '', 10000)
  if (!CONTENT_TYPES.includes(type) || !title || title === null || text === null) return fail(res, 'Invalid content data')
  try {
    const [result] = await pool.query('INSERT INTO system_content (type, title, body, status, sort_order) VALUES (?, ?, ?, ?, ?)', [type, title, text, bool(body.status === undefined ? 1 : body.status), Math.max(0, Number(body.sortOrder) || 0)])
    await audit(req, 'content.create', 'content', result.insertId, { type, title })
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateContent = async (req, res) => {
  const id = intId(req.params.id); const body = req.body || {}; const title = optionalText(body.title, 128); const text = optionalText(body.body, 10000)
  if (!id || title === null || text === null || (body.type && !CONTENT_TYPES.includes(body.type))) return fail(res, 'Invalid content data')
  const fields = []; const values = []
  ;[['type', body.type], ['title', title], ['body', text], ['status', body.status === undefined ? undefined : bool(body.status)], ['sort_order', body.sortOrder === undefined ? undefined : Math.max(0, Number(body.sortOrder) || 0)]].forEach(([key, value]) => { if (value !== undefined) { fields.push(key + ' = ?'); values.push(value) } })
  if (!fields.length) return fail(res, 'No changes supplied')
  try { const [result] = await pool.query(`UPDATE system_content SET ${fields.join(', ')} WHERE id = ?`, values.concat(id)); if (!result.affectedRows) return fail(res, 'Content not found', 404); await audit(req, 'content.update', 'content', id, { fields }); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.deleteContent = async (req, res) => {
  const id = intId(req.params.id); if (!id) return fail(res, 'Invalid content id')
  try { const [result] = await pool.query('DELETE FROM system_content WHERE id = ?', [id]); if (!result.affectedRows) return fail(res, 'Content not found', 404); await audit(req, 'content.delete', 'content', id, {}); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listFeatures = async (req, res) => { try { const [list] = await pool.query('SELECT id, config_key configKey, label, config_value configValue, status, updated_at updatedAt FROM feature_config ORDER BY id DESC'); success(res, { list }) } catch (e) { fail(res, safeMessage(e), 500) } }
exports.saveFeature = async (req, res) => {
  const body = req.body || {}; const key = optionalText(body.configKey, 64); const label = optionalText(body.label, 128); const value = optionalText(body.configValue || '', 10000)
  if (!key || key === null || !/^[a-z][a-z0-9_.-]*$/.test(key) || !label || label === null || value === null) return fail(res, 'Invalid feature configuration')
  try { await pool.query('INSERT INTO feature_config (config_key, label, config_value, status, updated_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label), config_value = VALUES(config_value), status = VALUES(status), updated_by = VALUES(updated_by)', [key, label, value, bool(body.status === undefined ? 1 : body.status), req.userId]); await audit(req, 'feature.save', 'feature', key, { label }); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listItems = async (req, res) => { try { const [list] = await pool.query('SELECT id, name, description, cover_url coverUrl, price, stock, status, updated_at updatedAt FROM virtual_item ORDER BY updated_at DESC'); success(res, { list }) } catch (e) { fail(res, safeMessage(e), 500) } }
exports.createItem = async (req, res) => {
  const body = req.body || {}; const name = optionalText(body.name, 128); const description = optionalText(body.description || '', 10000); const coverUrl = optionalText(body.coverUrl || '', 512); const price = Number(body.price); const stock = Number(body.stock)
  if (!name || name === null || description === null || coverUrl === null || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return fail(res, 'Invalid virtual item')
  try { const [result] = await pool.query('INSERT INTO virtual_item (name, description, cover_url, price, stock, status) VALUES (?, ?, ?, ?, ?, ?)', [name, description, coverUrl, price, stock, bool(body.status === undefined ? 1 : body.status)]); await pool.query('INSERT INTO virtual_item_log (item_id, admin_id, action, after_data) VALUES (?, ?, ?, ?)', [result.insertId, req.userId, 'create', JSON.stringify({ name, price, stock })]); await audit(req, 'item.create', 'virtual_item', result.insertId, { name }); success(res, { id: result.insertId }) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateItem = async (req, res) => {
  const id = intId(req.params.id); const body = req.body || {}; if (!id) return fail(res, 'Invalid item id')
  try {
    const [[before]] = await pool.query('SELECT id, name, description, cover_url, price, stock, sales_count, status FROM virtual_item WHERE id = ?', [id]); if (!before) return fail(res, 'Virtual item not found', 404)
    const name = body.name === undefined ? before.name : optionalText(body.name, 128); const description = body.description === undefined ? before.description : optionalText(body.description, 10000); const cover = body.coverUrl === undefined ? before.cover_url : optionalText(body.coverUrl, 512); const price = body.price === undefined ? Number(before.price) : Number(body.price); const stock = body.stock === undefined ? before.stock : Number(body.stock)
    if (!name || name === null || description === null || cover === null || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return fail(res, 'Invalid virtual item')
    const status = body.status === undefined ? before.status : bool(body.status)
    await pool.query('UPDATE virtual_item SET name = ?, description = ?, cover_url = ?, price = ?, stock = ?, status = ? WHERE id = ?', [name, description, cover, price, stock, status, id])
    await pool.query('INSERT INTO virtual_item_log (item_id, admin_id, action, before_data, after_data) VALUES (?, ?, ?, ?, ?)', [id, req.userId, 'update', JSON.stringify(before), JSON.stringify({ name, description, coverUrl: cover, price, stock, status })])
    await audit(req, 'item.update', 'virtual_item', id, { name, status }); success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listUsers = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query); const keyword = String(req.query.keyword || '').trim().slice(0, 64)
  try { const where = keyword ? 'WHERE nick_name LIKE ? OR phone LIKE ? OR student_id LIKE ?' : ''; const params = keyword ? ['%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%'] : []; const [[count], [list]] = await Promise.all([pool.query(`SELECT COUNT(*) total FROM sys_user ${where}`, params), pool.query(`SELECT id, nick_name nickName, avatar_url avatarUrl, campus, phone, student_id studentId, is_verified isVerified, cert_label certLabel, role, status, created_at createdAt FROM sys_user ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))]); success(res, { list, total: Number(count[0].total), page, hasMore: offset + list.length < Number(count[0].total) }) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateUserStatus = async (req, res) => {
  const id = intId(req.params.id); const status = bool((req.body || {}).status); if (!id || id === req.userId) return fail(res, 'Invalid account status operation')
  try {
    const [[target]] = await pool.query('SELECT role FROM sys_user WHERE id = ?', [id])
    if (!target) return fail(res, 'User not found', 404)
    if (!status && target.role === 'super_admin') {
      const [[count]] = await pool.query("SELECT COUNT(*) total FROM sys_user WHERE role = 'super_admin' AND status = 1")
      if (Number(count.total) <= 1) return fail(res, 'Keep at least one enabled super administrator')
    }
    await pool.query('UPDATE sys_user SET status = ? WHERE id = ?', [status, id])
    await audit(req, status ? 'user.enable' : 'user.disable', 'user', id, {})
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateUserRole = async (req, res) => {
  const id = intId(req.params.id); const role = String((req.body || {}).role || ''); if (!id || !ADMIN_ROLES.concat('user').includes(role) || id === req.userId) return fail(res, 'Invalid role operation')
  try { const [[target]] = await pool.query('SELECT role FROM sys_user WHERE id = ?', [id]); if (!target) return fail(res, 'User not found', 404); if (target.role === 'super_admin' && role !== 'super_admin') { const [[count]] = await pool.query("SELECT COUNT(*) total FROM sys_user WHERE role = 'super_admin' AND status = 1"); if (Number(count.total) <= 1) return fail(res, 'Keep at least one enabled super administrator') }; await pool.query('UPDATE sys_user SET role = ? WHERE id = ?', [role, id]); await audit(req, 'user.role', 'user', id, { from: target.role, to: role }); success(res, null) } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateUserCertLabel = async (req, res) => {
  const id = intId(req.params.id); const certLabel = optionalText((req.body || {}).certLabel || '', 32)
  if (!id) return fail(res, 'Invalid user id')
  if (certLabel === null) return fail(res, '认证信息最多 32 个字符')
  try {
    const [[target]] = await pool.query('SELECT id, nick_name FROM sys_user WHERE id = ?', [id])
    if (!target) return fail(res, 'User not found', 404)
    await pool.query('UPDATE sys_user SET cert_label = ? WHERE id = ?', [certLabel || null, id])
    await audit(req, 'user.cert_label', 'user', id, { certLabel: certLabel || null })
    success(res, { certLabel: certLabel || null })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listRiderVerifications = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const status = String(req.query.status || '').trim()
  const allowed = ['', 'pending', 'approved', 'rejected']
  if (!allowed.includes(status)) return fail(res, 'Invalid verification status')
  try {
    const where = status ? 'WHERE r.status = ?' : ''
    const params = status ? [status] : []
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM rider_verification r ${where}`, params),
      pool.query(
        `SELECT r.id, r.user_id userId, r.campus_name campusName, r.student_id studentId,
          r.campus_credential campusCredential, r.real_name realName,
          r.identity_number identityNumber, r.identity_credential identityCredential,
          r.phone, r.status, r.review_note reviewNote, r.reviewed_at reviewedAt,
          r.created_at createdAt, u.nick_name nickName, u.avatar_url avatarUrl
         FROM rider_verification r LEFT JOIN sys_user u ON u.id = r.user_id
         ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    success(res, { list, total: Number(count[0].total || 0), page, hasMore: offset + list.length < Number(count[0].total || 0) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// 骑手认证审核结果 → 微信订阅消息（通过→pushAuditPass；驳回→pushAuditCert）。
// 所有 data 字段落非空值：微信对空值字段直接返回 47003。
function notifyRiderVerification(userId, action, { campusName, studentId, note }) {
  if (!userId) return
  const nowText = new Date().toISOString()
  try {
    if (action === 'approve') {
      subscribeService.pushAuditPass(userId, {
        activityTitle: '骑手认证',
        communityName: String(campusName || '').trim() || '校园骑手',
        timeText: nowText,
        activityTime: nowText
      }).catch(() => {})
    } else {
      subscribeService.pushAuditCert(userId, {
        studentNo: String(studentId || '').replace(/\D/g, '') || 0,
        certText: '骑手身份认证',
        auditResult: '未通过',
        note: String(note || '').trim() || '请检查资料后重新提交',
        timeText: nowText
      }).catch(() => {})
    }
  } catch (e) { console.error('[RiderVerifySubscribe]', safeMessage(e)) }
}

exports.reviewRiderVerification = async (req, res) => {
  const id = intId(req.params.id)
  const body = req.body || {}
  const action = String(body.action || '').trim()
  const note = optionalText(body.note || '', 255)
  if (!id || !['approve', 'reject'].includes(action) || note === null) return fail(res, 'Invalid review action')
  try {
    const [[row]] = await pool.query('SELECT id, user_id, campus_name, student_id, status FROM rider_verification WHERE id = ?', [id])
    if (!row) return fail(res, 'Verification not found', 404)
    if (row.status !== 'pending') return fail(res, '该认证已审核，请勿重复操作', 400)
    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    await pool.query(
      'UPDATE rider_verification SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [newStatus, note || '', req.userId, id]
    )
    if (action === 'approve') {
      await pool.query('UPDATE sys_user SET is_verified = 1 WHERE id = ?', [row.user_id])
    }
    // 审核结果订阅提醒：通过走「审核通过提醒」，驳回走「认证审核通知」（用户在骑手认证页授权）。
    // 不 await：走微信外部接口，不拖慢管理端响应；data 字段必须全部非空，空值会被微信 47003 拒收。
    notifyRiderVerification(row.user_id, action, { campusName: row.campus_name, studentId: row.student_id, note })
    await audit(req, 'rider_verification.' + action, 'rider_verification', id, { userId: row.user_id, note: note || '' })
    success(res, null, action === 'approve' ? '已通过认证' : '已驳回认证')
  } catch (e) { fail(res, safeMessage(e), 500) }
}

// ===== 管理员账号管理（仅 super_admin：admin.manage 权限只有 '*' 角色命中） =====

exports.listAdmins = async (req, res) => {
  try {
    const [list] = await pool.query(
      `SELECT id, nick_name nickName, avatar_url avatarUrl, phone, role, status, created_at createdAt
       FROM sys_user
       WHERE role IN ('super_admin', 'content_admin', 'user_admin', 'operator')
       ORDER BY FIELD(role, 'super_admin', 'content_admin', 'user_admin', 'operator'), id`
    )
    success(res, { list: (list || []).map((row) => Object.assign({}, row, { permissions: permissionsFor(row.role) })) })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.createAdmin = async (req, res) => {
  const body = req.body || {}
  const query = String(body.query || '').trim().slice(0, 64)
  const role = String(body.role || '').trim()
  if (!query || !ADMIN_ROLES.includes(role)) return fail(res, '请填写用户并选择有效的管理员角色')
  try {
    const [rows] = await pool.query(
      'SELECT id, nick_name, role, status FROM sys_user WHERE id = ? OR phone = ? OR student_id = ? LIMIT 2',
      [/^\d+$/.test(query) ? Number(query) : 0, query, query]
    )
    if (!rows.length) return fail(res, '未找到该用户，请确认用户 ID / 手机号 / 学号', 404)
    if (rows.length > 1) return fail(res, '匹配到多个用户，请改用用户 ID 精确指定')
    const target = rows[0]
    if (target.role !== 'user') return fail(res, `该用户已是管理员（${target.role}），请直接调整角色`)
    if (Number(target.status) !== 1) return fail(res, '该账号已被禁用，请先启用再设置管理员')
    await pool.query('UPDATE sys_user SET role = ? WHERE id = ?', [role, target.id])
    await audit(req, 'admin.create', 'user', target.id, { role })
    success(res, { id: target.id, role })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.listAuditLogs = async (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query)
  const action = String(req.query.action || '').trim().replace(/[%_]/g, '').slice(0, 48)
  try {
    const where = action ? 'WHERE l.action LIKE ?' : ''
    const params = action ? [action + '%'] : []
    const [[count], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM admin_audit_log l ${where}`, params),
      pool.query(
        `SELECT l.id, l.action, l.target_type targetType, l.target_id targetId, l.detail, l.ip, l.created_at createdAt,
          u.id adminId, u.nick_name adminName
         FROM admin_audit_log l LEFT JOIN sys_user u ON u.id = l.admin_id
         ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
        params.concat([pageSize, offset])
      )
    ])
    const list = (rows || []).map((row) => {
      let detail = {}
      try { detail = JSON.parse(row.detail) || {} } catch (e) {}
      return Object.assign({}, row, { detail })
    })
    const total = Number(count[0].total || 0)
    success(res, { list, total, page, hasMore: offset + list.length < total })
  } catch (e) { fail(res, safeMessage(e), 500) }
}


// ===== 服务宫格项管理（service_item）：外部小程序 AppID / 图标 / 链接可后台配置，替代端上硬编码兜底 =====
exports.listServices = async (req, res) => {
  try {
    const [categories] = await pool.query('SELECT id, name, sort_order sortOrder FROM service_category ORDER BY sort_order, id')
    const [list] = await pool.query('SELECT id, category_id categoryId, name, icon, badge, link, mini_app_id miniAppId, icon_path iconPath, sort_order sortOrder, status FROM service_item ORDER BY sort_order, id')
    success(res, { categories, list })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.createService = async (req, res) => {
  const body = req.body || {}
  const name = optionalText(body.name, 64)
  const categoryId = intId(body.categoryId)
  const icon = optionalText(body.icon || '', 16)
  const iconPath = optionalText(body.iconPath || '', 256)
  const badge = optionalText(body.badge || '', 16)
  const link = optionalText(body.link || '', 256)
  const miniAppId = optionalText(body.miniAppId || '', 64)
  const sortOrder = Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0
  if (!name || name === null || !categoryId) return fail(res, '服务名称与所属分类必填')
  if ([icon, iconPath, badge, link, miniAppId].some((v) => v === null)) return fail(res, '服务字段过长')
  try {
    const [result] = await pool.query(
      'INSERT INTO service_item (category_id, name, icon, icon_path, badge, link, mini_app_id, sort_order, status) VALUES (?,?,?,?,?,?,?,?,?)',
      [categoryId, name, icon, iconPath, badge, link, miniAppId, sortOrder, bool(body.status === undefined ? 1 : body.status)]
    )
    await audit(req, 'service.create', 'service_item', result.insertId, { name })
    success(res, { id: result.insertId })
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.updateService = async (req, res) => {
  const id = intId(req.params.id)
  const body = req.body || {}
  if (!id) return fail(res, 'Invalid service id')
  try {
    const [[before]] = await pool.query('SELECT * FROM service_item WHERE id = ?', [id])
    if (!before) return fail(res, 'Service not found', 404)
    const name = body.name === undefined ? before.name : optionalText(body.name, 64)
    const categoryId = body.categoryId === undefined ? before.category_id : intId(body.categoryId)
    const icon = body.icon === undefined ? before.icon : optionalText(body.icon, 16)
    const iconPath = body.iconPath === undefined ? before.icon_path : optionalText(body.iconPath, 256)
    const badge = body.badge === undefined ? before.badge : optionalText(body.badge, 16)
    const link = body.link === undefined ? before.link : optionalText(body.link, 256)
    const miniAppId = body.miniAppId === undefined ? before.mini_app_id : optionalText(body.miniAppId, 64)
    const sortOrder = body.sortOrder === undefined ? before.sort_order : Number(body.sortOrder)
    if (!name || name === null || !categoryId || [icon, iconPath, badge, link, miniAppId].some((v) => v === null)) return fail(res, '服务字段无效')
    const status = body.status === undefined ? before.status : bool(body.status)
    await pool.query(
      'UPDATE service_item SET category_id = ?, name = ?, icon = ?, icon_path = ?, badge = ?, link = ?, mini_app_id = ?, sort_order = ?, status = ? WHERE id = ?',
      [categoryId, name, icon, iconPath, badge, link, miniAppId, Number.isInteger(sortOrder) ? sortOrder : 0, status, id]
    )
    await audit(req, 'service.update', 'service_item', id, { name })
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}

exports.deleteService = async (req, res) => {
  const id = intId(req.params.id)
  if (!id) return fail(res, 'Invalid service id')
  try {
    const [result] = await pool.query('DELETE FROM service_item WHERE id = ?', [id])
    if (!result.affectedRows) return fail(res, 'Service not found', 404)
    await audit(req, 'service.delete', 'service_item', id, {})
    success(res, null)
  } catch (e) { fail(res, safeMessage(e), 500) }
}