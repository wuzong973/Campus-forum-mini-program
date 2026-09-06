const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { createNotification } = require('../services/notificationService')
const paymentController = require('./paymentController')
const wsServer = require('../ws/wsServer')

const CAMPUS_GROUPS = {
  '广州校区': ['广州校区', '新港校区', '琶洲校区'],
  '佛山校区': ['佛山校区', '南海南校区', '南海北校区']
}

// 接单方取消接单规则（与小程序取消页温馨提示一致）：
// 1. 接单后30分钟内且因自身原因，可直接取消接单，订单终止、赏金原路退回发单人，但会降低完成率；
// 2. 接单后30分钟内因发单人原因，或超过30分钟的任意原因，均需发单人同意后才能取消接单；
// 3. 发单人同意后订单同样终止并原路退款；
// 4. 自身原因多次取消将降低完成率，完成率过低冻结接单功能。
const FREE_CANCEL_MINUTES = 30
const FREEZE_MIN_RECORDS = 3
const FREEZE_RATE = 0.5

function orderRole(order, userId) {
  if (Number(order.publisher_id) === Number(userId)) return 'publisher'
  if (Number(order.acceptor_id) === Number(userId)) return 'acceptor'
  return 'viewer'
}

function validStatus(status) {
  // active = 接单大厅展示中的订单（待接单 + 进行中）
  return ['pending', 'accepted', 'finished', 'cancelled', 'active'].includes(status) ? status : ''
}

function cleanImages(input) {
  return Array.isArray(input) ? input.filter((item) => typeof item === 'string' && item).slice(0, 3) : []
}

async function logOrder(conn, orderId, actorId, action, detail) {
  await conn.query(
    'INSERT INTO errand_order_log (order_id, actor_id, action, detail) VALUES (?, ?, ?, ?)',
    [orderId, actorId || null, String(action), String(detail || '').slice(0, 255)]
  )
}

async function bumpStat(conn, userId, field) {
  if (!['finished_count', 'self_cancel_count'].includes(field)) return
  await conn.query(
    `INSERT INTO errand_stat (user_id, ${field}) VALUES (?, 1) ON DUPLICATE KEY UPDATE ${field} = ${field} + 1`,
    [userId]
  )
}

// 完成率过低判定：完成+自身取消满 FREEZE_MIN_RECORDS 单且完成率低于 FREEZE_RATE
async function isRunnerFrozen(conn, userId) {
  const [rows] = await conn.query('SELECT finished_count, self_cancel_count FROM errand_stat WHERE user_id = ?', [userId])
  const stat = rows[0]
  if (!stat) return false
  const total = Number(stat.finished_count) + Number(stat.self_cancel_count)
  return total >= FREEZE_MIN_RECORDS && Number(stat.finished_count) / total < FREEZE_RATE
}

// 接单方取消接单（或发单人同意取消）后订单终止，赏金由 paymentController 原路退回
async function terminateOrder(conn, orderId) {
  await conn.query("UPDATE errand_order SET status = 'cancelled' WHERE id = ?", [orderId])
}

// 发起赏金退款；失败不阻断主流程（订单已终止，退款可由对账任务重试）
async function refundOrderTolerant(orderId) {
  try {
    const result = await paymentController.cancelErrandAndRefund(orderId)
    return (result && result.refund && result.refund.status) || null
  } catch (e) {
    console.error('[ErrandRefund]', safeMessage(e))
    return 'FAILED'
  }
}

async function notify(userId, title, content, relatedId) {
  try {
    await createNotification({ userId, type: 'errand', title, content, relatedId })
  } catch (e) {
    console.error('[Notification]', safeMessage(e))
  }
}

exports.list = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = clampPageSize(req.query.pageSize)
  const type = String(req.query.type || '').trim()
  const campus = String(req.query.campus || '').trim()
  const status = validStatus(String(req.query.status || 'pending'))
  const minPrice = Number(req.query.minPrice)
  const maxPrice = Number(req.query.maxPrice)
  const offset = (page - 1) * pageSize
  if (req.query.status && !status) return fail(res, '订单状态无效')
  if (Number.isFinite(minPrice) && Number.isFinite(maxPrice) && minPrice > maxPrice) return fail(res, '价格范围无效')
  try {
    let where = "WHERE e.payment_status = 'SUCCESS'"
    const params = []
    const userId = req.userId || 0
    let effectiveCampus = campus
    let canViewAllRegions = false
    if (userId) {
      const [userRows] = await pool.query('SELECT role, campus FROM sys_user WHERE id = ?', [userId])
      const user = userRows[0]
      canViewAllRegions = !!user && ['admin', 'super_admin'].includes(user.role)
      // 非管理员优先按本人校区过滤；未设置校区时回退到请求指定的校区
      if (!canViewAllRegions) effectiveCampus = (user && user.campus) || campus
    }
    if (status === 'active') { where += " AND e.status IN ('pending', 'accepted')" }
    else if (status) { where += ' AND e.status = ?'; params.push(status) }
    if (type) { where += ' AND e.type = ?'; params.push(type) }
    if (effectiveCampus) {
      const campuses = CAMPUS_GROUPS[effectiveCampus] || [effectiveCampus]
      where += ' AND e.campus IN (' + campuses.map(() => '?').join(', ') + ')'
      params.push(...campuses)
    }
    if (Number.isFinite(minPrice)) { where += ' AND e.reward >= ?'; params.push(minPrice) }
    if (Number.isFinite(maxPrice)) { where += ' AND e.reward <= ?'; params.push(maxPrice) }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM errand_order e ${where}`, params)
    const [rows] = await pool.query(
      `SELECT e.id, e.publisher_id, e.acceptor_id, e.type, e.title, e.reward, e.pickup_addr, e.delivery_addr,
        e.campus, e.gender_requirement, e.pickup_time_type, e.appointment_time, e.is_large_item,
        e.is_urgent, e.status, e.created_at, e.updated_at, u.nick_name AS publisher_name,
        u.avatar_url AS publisher_avatar, a.nick_name AS acceptor_name,
        CASE WHEN e.publisher_id = ? OR e.acceptor_id = ? THEN e.description ELSE NULL END AS description,
        e.remark
       FROM errand_order e
       LEFT JOIN sys_user u ON e.publisher_id = u.id
       LEFT JOIN sys_user a ON e.acceptor_id = a.id
       ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      // 占位符仅 CASE WHEN 两处使用 userId，传 4 个会导致 IN/LIMIT/OFFSET 参数整体错位
      [userId, userId].concat(params, [pageSize, offset])
    )
    success(res, { list: rows, total: count.total, hasMore: offset + pageSize < count.total })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.create = async (req, res) => {
  const body = req.body || {}
  const reward = Number(body.reward || body.totalAmount || body.baseAmount)
  const title = String(body.title || '').trim() || `${String(body.type || '跑腿').trim()}代拿`
  const receiverName = String(body.receiverName || '').trim()
  const receiverPhone = String(body.receiverPhone || '').trim()
  const deliveryBuilding = String(body.deliveryBuilding || '').trim()
  const deliveryRoom = String(body.deliveryRoom || '').trim()
  if (!Number.isFinite(reward) || reward <= 0 || !body.campus || !body.genderRequirement || !receiverName || !receiverPhone) return fail(res, '订单信息不完整')
  if (body.pickupTimeType === '预约') {
    // 期望完成时间为用户手动填写的自由文本（如：今天下午3点前）
    const appointmentText = String(body.appointmentTime || '').trim()
    if (!appointmentText || appointmentText.length > 64) return fail(res, '请填写期望完成时间')
    body.appointmentTime = appointmentText
  }
  try {
    const images = Array.isArray(body.images) ? body.images.filter((item) => typeof item === 'string' && item).slice(0, 3) : []
    const [result] = await pool.query(
      `INSERT INTO errand_order (publisher_id, type, title, description, reward, pickup_addr, delivery_addr, campus, gender_requirement, pickup_time_type, appointment_time, receiver_name, receiver_phone, delivery_building, delivery_room, remark, images, is_large_item, is_urgent, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID')`,
      [req.userId, String(body.type || '').trim(), title, String(body.description || '').trim(), reward, String(body.pickupAddr || '').trim(), String(body.deliveryAddr || '').trim(), String(body.campus).trim(), String(body.genderRequirement).trim(), body.pickupTimeType || '尽快', body.pickupTimeType === '预约' ? body.appointmentTime : null, receiverName, receiverPhone, deliveryBuilding, deliveryRoom, String(body.remark || '').trim(), JSON.stringify(images), body.isLargeItem ? 1 : 0, body.isUrgent ? 1 : 0]
    )
    success(res, { id: result.insertId })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.accept = async (req, res) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [runnerRows] = await conn.query('SELECT is_verified, phone FROM sys_user WHERE id = ? FOR UPDATE', [req.userId])
    const runner = runnerRows[0]
    if (!runner || !runner.is_verified || !runner.phone) {
      await conn.rollback()
      return fail(res, '请先完成骑手认证，审核通过后方可接单', 403)
    }
    const [verifyRows] = await conn.query('SELECT status FROM rider_verification WHERE user_id = ?', [req.userId])
    if (!verifyRows.length || verifyRows[0].status !== 'approved') {
      await conn.rollback()
      return fail(res, '您的骑手认证尚未通过审核，请耐心等待', 403)
    }
    if (await isRunnerFrozen(conn, req.userId)) {
      await conn.rollback()
      return fail(res, '您因多次取消接单，完成率过低，接单功能已被冻结，请联系客服处理', 403)
    }
    const [rows] = await conn.query("SELECT * FROM errand_order WHERE id = ? AND status = 'pending' AND payment_status = 'SUCCESS' FOR UPDATE", [req.params.id])
    if (!rows.length) { await conn.rollback(); return fail(res, '订单不存在或已被接单') }
    const order = rows[0]
    if (Number(order.publisher_id) === Number(req.userId)) { await conn.rollback(); return fail(res, '不能接自己的单') }
    await conn.query("UPDATE errand_order SET status = 'accepted', acceptor_id = ?, accepted_at = NOW() WHERE id = ?", [req.userId, order.id])
    await logOrder(conn, order.id, req.userId, 'accepted', '同学接单，订单进行中')
    await conn.commit()
    await notify(order.publisher_id, '跑腿订单已被接单', `“${order.title}”已有同学接单`, order.id)
    success(res, null, '接单成功')
  } catch (e) {
    await conn.rollback()
    fail(res, safeMessage(e), 500)
  } finally {
    conn.release()
  }
}

exports.finish = async (req, res) => {
  const description = String((req.body && req.body.description) || '').trim().slice(0, 500)
  const images = cleanImages(req.body && req.body.images)
  try {
    const [rows] = await pool.query("SELECT * FROM errand_order WHERE id = ? AND status = 'accepted'", [req.params.id])
    if (!rows.length) return fail(res, '订单状态不允许完成')
    const order = rows[0]
    if (![Number(order.publisher_id), Number(order.acceptor_id)].includes(Number(req.userId))) return fail(res, '无权完成订单', 403)
    const [result] = await pool.query(
      "UPDATE errand_order SET status = 'finished', finish_description = ?, finish_images = ?, finished_at = NOW() WHERE id = ? AND status = 'accepted'",
      [description, JSON.stringify(images), order.id]
    )
    if (!result.affectedRows) return fail(res, '订单状态不允许完成')
    await logOrder(pool, order.id, req.userId, 'finished', description ? `订单完成：${description}` : '订单完成')
    // 完成单计入接单方完成率统计
    if (order.acceptor_id) await bumpStat(pool, order.acceptor_id, 'finished_count')
    // Earnings become withdrawable only after the paid errand is finished.
    if (order.acceptor_id && order.payment_status === 'SUCCESS') {
      await pool.query(
        "INSERT IGNORE INTO wallet_ledger (user_id, entry_type, amount_fen, reference_type, reference_id, title) VALUES (?, 'ERRAND_EARNING', ?, 'errand_order', ?, ?)",
        [order.acceptor_id, Math.round(Number(order.reward) * 100), order.id, `Errand income #${order.id}`]
      )
    }
    const recipientId = Number(order.publisher_id) === Number(req.userId) ? order.acceptor_id : order.publisher_id
    await notify(recipientId, '跑腿订单已完成', `“${order.title}”已完成，可前往评价`, order.id)
    success(res, null, '订单已完成')
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.cancel = async (req, res) => {
  const body = req.body || {}
  const reason = String(body.reason || '').trim().slice(0, 255)
  try {
    const [rows] = await pool.query("SELECT * FROM errand_order WHERE id = ? AND status IN ('pending', 'accepted')", [req.params.id])
    if (!rows.length) return fail(res, '订单状态不允许取消')
    const order = rows[0]
    if (Number(order.publisher_id) !== Number(req.userId)) return fail(res, '无权取消订单', 403)
    const [result] = await pool.query("UPDATE errand_order SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'accepted')", [order.id])
    if (!result.affectedRows) return fail(res, '订单状态不允许取消')
    const sideLabel = body.reasonSide === 'accepter' ? '接单人原因' : '自身原因'
    const reasonDetail = reason ? `（${sideLabel}：${reason}）` : ''
    await logOrder(pool, order.id, req.userId, 'cancelled', `发布者取消订单${reasonDetail}，赏金将原路退回`)
    // 取消后遗留的待处理取消申请一并关闭
    await pool.query("UPDATE errand_cancel_request SET status = 'rejected', handled_at = NOW() WHERE order_id = ? AND status = 'pending'", [order.id])
    if (order.acceptor_id) await notify(order.acceptor_id, '跑腿订单已取消', `“${order.title}”已被发布者取消`, order.id)
    success(res, null, '订单已取消')
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 接单方取消接单：30分钟内且自身原因可直接取消，其余需发单人同意
exports.release = async (req, res) => {
  const body = req.body || {}
  const reasonSide = body.reasonSide === 'publisher' ? 'publisher' : 'self'
  const reason = String(body.reason || '').trim().slice(0, 255)
  const images = cleanImages(body.images)
  if (!reason) return fail(res, '请填写取消接单理由')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query("SELECT * FROM errand_order WHERE id = ? AND status = 'accepted' FOR UPDATE", [req.params.id])
    if (!rows.length) { await conn.rollback(); return fail(res, '订单状态不允许取消接单') }
    const order = rows[0]
    if (Number(order.acceptor_id) !== Number(req.userId)) { await conn.rollback(); return fail(res, '你尚未接下该订单', 403) }
    const acceptedTs = order.accepted_at ? new Date(order.accepted_at).getTime() : Date.now()
    const withinFreeWindow = Date.now() - acceptedTs <= FREE_CANCEL_MINUTES * 60 * 1000
    if (withinFreeWindow && reasonSide === 'self') {
      await terminateOrder(conn, order.id)
      await bumpStat(conn, req.userId, 'self_cancel_count')
      await logOrder(conn, order.id, req.userId, 'self_cancel', `接单方因自身原因取消接单：${reason}`)
      await conn.commit()
      const refundStatus = await refundOrderTolerant(order.id)
      await notify(order.publisher_id, '接单方已取消接单', `“${order.title}”的接单同学已取消接单，订单已终止，赏金将原路退回`, order.id)
      return success(res, { mode: 'released', refundStatus }, refundStatus === 'FAILED' ? '已取消接单，退款发起失败，请联系客服' : '已取消接单，赏金将原路退回')
    }
    const [existing] = await conn.query("SELECT id FROM errand_cancel_request WHERE order_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE", [order.id])
    if (existing.length) { await conn.rollback(); return fail(res, '你已提交过取消申请，请等待发单人处理', 409) }
    await conn.query(
      "INSERT INTO errand_cancel_request (order_id, requester_id, reason_side, reason, images) VALUES (?, ?, ?, ?, ?)",
      [order.id, req.userId, reasonSide, reason, JSON.stringify(images)]
    )
    await logOrder(conn, order.id, req.userId, 'cancel_requested', `接单方申请取消接单（${reasonSide === 'publisher' ? '发单人原因' : '自身原因'}）：${reason}`)
    await conn.commit()
    await notify(
      order.publisher_id,
      '收到取消接单申请',
      `“${order.title}”的接单同学申请取消接单（${reasonSide === 'publisher' ? '发单人原因' : '自身原因'}：${reason}），请前往订单详情处理`,
      order.id
    )
    success(res, { mode: 'requested' }, '已提交申请，请等待发单人同意')
  } catch (e) {
    await conn.rollback()
    fail(res, safeMessage(e), 500)
  } finally {
    conn.release()
  }
}

// 发单人处理取消接单申请：approve=true 同意（订单终止并原路退款），false 拒绝（订单继续进行）
exports.reviewCancelRequest = async (req, res) => {
  const requestId = Number(req.params.id)
  const approve = !!(req.body && req.body.approve)
  if (!Number.isInteger(requestId) || requestId < 1) return fail(res, 'Invalid request id')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query(
      `SELECT r.*, e.title, e.publisher_id, e.status AS order_status
       FROM errand_cancel_request r JOIN errand_order e ON r.order_id = e.id
       WHERE r.id = ? FOR UPDATE`, [requestId]
    )
    const request = rows[0]
    if (!request) { await conn.rollback(); return fail(res, '取消申请不存在', 404) }
    if (Number(request.publisher_id) !== Number(req.userId)) { await conn.rollback(); return fail(res, '仅发单人可以处理该申请', 403) }
    if (request.status !== 'pending') { await conn.rollback(); return fail(res, '该申请已处理过，请勿重复操作', 409) }
    if (approve && request.order_status !== 'accepted') {
      await conn.query("UPDATE errand_cancel_request SET status = 'rejected', handled_at = NOW() WHERE id = ?", [requestId])
      await conn.commit()
      return fail(res, '订单状态已变化，无需处理')
    }
    if (approve) {
      await terminateOrder(conn, request.order_id)
      await conn.query("UPDATE errand_cancel_request SET status = 'approved', handled_at = NOW() WHERE id = ?", [requestId])
      // 自身原因导致的取消计入接单方完成率统计
      if (request.reason_side === 'self') await bumpStat(conn, request.requester_id, 'self_cancel_count')
      await logOrder(conn, request.order_id, req.userId, 'cancel_approved', '发单人同意取消接单，订单已终止，赏金原路退回')
      await conn.commit()
      const refundStatus = await refundOrderTolerant(request.order_id)
      await notify(request.requester_id, '取消接单申请已通过', `“${request.title}”的发单人同意了你的取消申请，订单已终止，赏金将退回发单人`, request.order_id)
      return success(res, { status: 'approved', refundStatus }, '已同意取消接单，订单已终止')
    }
    await conn.query("UPDATE errand_cancel_request SET status = 'rejected', handled_at = NOW() WHERE id = ?", [requestId])
    await logOrder(conn, request.order_id, req.userId, 'cancel_rejected', '发单人拒绝了取消接单申请，订单继续进行')
    await conn.commit()
    await notify(request.requester_id, '取消接单申请被拒绝', `“${request.title}”的发单人拒绝了你的取消申请，请继续完成订单`, request.order_id)
    success(res, { status: 'rejected' }, '已拒绝该申请')
  } catch (e) {
    await conn.rollback()
    fail(res, safeMessage(e), 500)
  } finally {
    conn.release()
  }
}

// 订单流水记录（仅订单参与双方可见）
exports.logs = async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT publisher_id, acceptor_id FROM errand_order WHERE id = ?', [req.params.id])
    if (!orders.length) return fail(res, '订单不存在', 404)
    if (orderRole(orders[0], req.userId) === 'viewer') return fail(res, '无权查看该订单记录', 403)
    const [rows] = await pool.query(
      `SELECT l.id, l.action, l.detail, l.created_at, u.nick_name AS actor_name
       FROM errand_order_log l LEFT JOIN sys_user u ON l.actor_id = u.id
       WHERE l.order_id = ? ORDER BY l.created_at ASC, l.id ASC`,
      [req.params.id]
    )
    success(res, { list: rows })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

async function listMine(req, res, field) {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, p.nick_name AS publisher_name, p.avatar_url AS publisher_avatar, a.nick_name AS acceptor_name
       FROM errand_order e LEFT JOIN sys_user p ON e.publisher_id = p.id LEFT JOIN sys_user a ON e.acceptor_id = a.id
       WHERE e.${field} = ? ORDER BY e.created_at DESC`,
      [req.userId]
    )
    success(res, { list: rows })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.myPublished = (req, res) => listMine(req, res, 'publisher_id')
exports.myAccepted = (req, res) => listMine(req, res, 'acceptor_id')

exports.detail = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, p.nick_name AS publisher_name, p.avatar_url AS publisher_avatar, a.nick_name AS acceptor_name
       FROM errand_order e LEFT JOIN sys_user p ON e.publisher_id = p.id LEFT JOIN sys_user a ON e.acceptor_id = a.id
       WHERE e.id = ? LIMIT 1`, [req.params.id]
    )
    if (!rows.length) return fail(res, '订单不存在', 404)
    const order = rows[0]
    const role = orderRole(order, req.userId)
    const canViewPrivate = role !== 'viewer'
    order.role = role
    if (!canViewPrivate) ['description', 'receiver_name', 'receiver_phone', 'delivery_building', 'delivery_room', 'finish_description', 'finish_images'].forEach((key) => delete order[key])
    let cancelRequest = null
    if (canViewPrivate) {
      // 待处理的取消接单申请（接单方与发单人都需要看到）
      const [requestRows] = await pool.query(
        "SELECT id, requester_id, reason_side, reason, images, status, created_at FROM errand_cancel_request WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
        [order.id]
      )
      if (requestRows.length) cancelRequest = requestRows[0]
      // 联系电话：接单方联系发单人，发单人联系接单方
      const peerId = role === 'publisher' ? order.acceptor_id : order.publisher_id
      if (peerId) {
        const [peerRows] = await pool.query('SELECT phone FROM sys_user WHERE id = ?', [peerId])
        if (peerRows.length && peerRows[0].phone) order.contact_phone = peerRows[0].phone
      }
    }
    success(res, { order, canViewRemark: canViewPrivate, cancelRequest })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

exports.review = async (req, res) => {
  const rating = Number(req.body.rating)
  const content = String(req.body.content || '').trim()
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, '评分应为1至5分')
  try {
    const [rows] = await pool.query("SELECT * FROM errand_order WHERE id = ? AND status = 'finished'", [req.params.id])
    if (!rows.length) return fail(res, '仅已完成订单可以评价')
    const order = rows[0]
    const role = orderRole(order, req.userId)
    if (role === 'viewer') return fail(res, '无权评价该订单', 403)
    const targetId = role === 'publisher' ? order.acceptor_id : order.publisher_id
    await pool.query('INSERT INTO errand_review (order_id, reviewer_id, target_id, rating, content) VALUES (?, ?, ?, ?, ?)', [order.id, req.userId, targetId, rating, content])
    await notify(targetId, '你收到了跑腿评价', `“${order.title}”获得 ${rating} 星评价`, order.id)
    success(res, null, '评价成功')
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, '你已评价过该订单', 409)
    fail(res, safeMessage(e), 500)
  }
}

// ===== 跑腿订单专属聊天（与私信完全独立，双方真实身份） =====

function publicOrderBrief(order) {
  return {
    id: order.id,
    title: order.title,
    remark: order.remark,
    reward: order.reward,
    campus: order.campus,
    status: order.status,
    publisherId: order.publisher_id,
    acceptorId: order.acceptor_id
  }
}

// 聊天会话列表：我参与且已接单/已完成的订单，含对方身份、最后一条消息与未读数
exports.chats = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.title, e.remark, e.description, e.reward, e.status, e.publisher_id, e.acceptor_id, e.updated_at, e.created_at,
        p.nick_name AS publisher_name, p.avatar_url AS publisher_avatar,
        a.nick_name AS acceptor_name, a.avatar_url AS acceptor_avatar,
        r.last_read_id
       FROM errand_order e
       LEFT JOIN sys_user p ON e.publisher_id = p.id
       LEFT JOIN sys_user a ON e.acceptor_id = a.id
       LEFT JOIN errand_chat_read r ON r.order_id = e.id AND r.user_id = ?
       WHERE (e.publisher_id = ? OR e.acceptor_id = ?) AND e.status IN ('accepted', 'finished')
       ORDER BY COALESCE(e.updated_at, e.created_at) DESC, e.id DESC LIMIT 200`,
      [req.userId, req.userId, req.userId]
    )
    const orderIds = rows.map((r) => r.id)
    const latestMap = {}
    const unreadMap = {}
    if (orderIds.length) {
      const [latestRows] = await pool.query(
        `SELECT m.* FROM errand_message m
         JOIN (SELECT order_id, MAX(id) AS max_id FROM errand_message WHERE order_id IN (?) GROUP BY order_id) t
         ON m.order_id = t.order_id AND m.id = t.max_id`,
        [orderIds]
      )
      latestRows.forEach((m) => { latestMap[m.order_id] = m })
      const [unreadRows] = await pool.query(
        `SELECT m.order_id, COUNT(*) AS cnt FROM errand_message m
         LEFT JOIN errand_chat_read r ON r.order_id = m.order_id AND r.user_id = ?
         WHERE m.order_id IN (?) AND m.sender_id <> ? AND m.id > IFNULL(r.last_read_id, 0)
         GROUP BY m.order_id`,
        [req.userId, orderIds, req.userId]
      )
      unreadRows.forEach((u) => { unreadMap[u.order_id] = u.cnt })
    }
    const list = rows.map((r) => {
      const isPublisher = Number(r.publisher_id) === Number(req.userId)
      const last = latestMap[r.id] || null
      return {
        orderId: r.id,
        role: isPublisher ? 'publisher' : 'acceptor',
        peerId: isPublisher ? r.acceptor_id : r.publisher_id,
        peerName: (isPublisher ? r.acceptor_name : r.publisher_name) || '校园用户',
        peerAvatar: (isPublisher ? r.acceptor_avatar : r.publisher_avatar) || '/assets/icons/avatar.png',
        orderTitle: r.title,
        orderRemark: r.remark || r.description || '',
        reward: Number(r.reward || 0).toFixed(2),
        orderStatus: r.status,
        lastText: last ? (last.msg_type === 'image' ? '[图片]' : last.msg_type === 'video' ? '[视频]' : String(last.content).slice(0, 80)) : '',
        lastTime: last ? last.created_at : null,
        unreadCount: unreadMap[r.id] || 0
      }
    })
    success(res, { list })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 聊天记录：仅订单参与双方可见，返回对方真实身份与订单概要
exports.chatMessages = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = clampPageSize(req.query.pageSize, 50)
  const offset = (page - 1) * pageSize
  try {
    const [orders] = await pool.query('SELECT * FROM errand_order WHERE id = ? LIMIT 1', [req.params.id])
    if (!orders.length) return fail(res, '订单不存在', 404)
    const order = orders[0]
    const role = orderRole(order, req.userId)
    if (role === 'viewer') return fail(res, '仅订单参与双方可以查看该聊天', 403)
    const peerId = role === 'publisher' ? order.acceptor_id : order.publisher_id
    if (!peerId) return fail(res, '对方尚未接单，暂无聊天对象', 400)
    const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM errand_message WHERE order_id = ?', [order.id])
    const [rows] = await pool.query(
      `SELECT m.*, u.nick_name AS sender_nick, u.avatar_url AS sender_avatar
       FROM errand_message m LEFT JOIN sys_user u ON m.sender_id = u.id
       WHERE m.order_id = ? ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [order.id, pageSize, offset]
    )
    const [peers] = await pool.query('SELECT id, nick_name, avatar_url FROM sys_user WHERE id = ?', [peerId])
    const total = countRows[0].total
    success(res, {
      list: rows.reverse().map((r) => ({
        id: r.id,
        orderId: r.order_id,
        senderId: r.sender_id,
        content: r.content,
        msgType: r.msg_type,
        senderNick: r.sender_nick,
        senderAvatar: r.sender_avatar,
        createdAt: r.created_at
      })),
      total,
      hasMore: offset + pageSize < total,
      role,
      peer: peers[0] || { id: peerId, nick_name: '校园用户', avatar_url: '/assets/icons/avatar.png' },
      order: publicOrderBrief(order)
    })
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 发送聊天消息：仅订单参与双方，真实身份展示
exports.sendChatMessage = async (req, res) => {
  const content = String((req.body && req.body.content) || '').trim()
  const msgType = ['text', 'image', 'video'].includes(req.body && req.body.msgType) ? req.body.msgType : 'text'
  if (!content) return fail(res, '消息内容不能为空')
  if (content.length > 1000) return fail(res, '消息不能超过1000个字符')
  try {
    const [orders] = await pool.query('SELECT * FROM errand_order WHERE id = ? LIMIT 1', [req.params.id])
    if (!orders.length) return fail(res, '订单不存在', 404)
    const order = orders[0]
    const role = orderRole(order, req.userId)
    if (role === 'viewer') return fail(res, '仅订单参与双方可以发送聊天消息', 403)
    const peerId = role === 'publisher' ? order.acceptor_id : order.publisher_id
    if (!peerId) return fail(res, '对方尚未接单，暂无法发送消息', 400)
    const [result] = await pool.query(
      'INSERT INTO errand_message (order_id, sender_id, content, msg_type) VALUES (?, ?, ?, ?)',
      [order.id, req.userId, content, msgType]
    )
    const data = { id: result.insertId, orderId: order.id, senderId: Number(req.userId), content, msgType, createdAt: new Date().toISOString() }
    // 实时推送给对方（在线时秒达；不在线由对方拉取）
    wsServer.sendToUser(peerId, { type: 'errand_message', data })
    success(res, data)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

// 标记聊天已读：把已读位置推进到该订单当前最大消息 id
exports.markChatRead = async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT publisher_id, acceptor_id FROM errand_order WHERE id = ? LIMIT 1', [req.params.id])
    if (!orders.length) return fail(res, '订单不存在', 404)
    if (orderRole(orders[0], req.userId) === 'viewer') return fail(res, '无权操作该聊天', 403)
    const [[maxRow]] = await pool.query('SELECT IFNULL(MAX(id), 0) AS max_id FROM errand_message WHERE order_id = ?', [req.params.id])
    await pool.query(
      `INSERT INTO errand_chat_read (order_id, user_id, last_read_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_read_id = VALUES(last_read_id)`,
      [req.params.id, req.userId, maxRow.max_id || 0]
    )
    success(res, null)
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}
