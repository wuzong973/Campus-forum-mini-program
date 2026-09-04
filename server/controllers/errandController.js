const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { clampPageSize, safeMessage } = require('../utils/helpers')
const { createNotification } = require('../services/notificationService')

const CAMPUS_GROUPS = {
  '广州校区': ['广州校区', '新港校区', '琶洲校区'],
  '佛山校区': ['佛山校区', '南海南校区', '南海北校区']
}

function orderRole(order, userId) {
  if (Number(order.publisher_id) === Number(userId)) return 'publisher'
  if (Number(order.acceptor_id) === Number(userId)) return 'acceptor'
  return 'viewer'
}

function validStatus(status) {
  return ['pending', 'accepted', 'finished', 'cancelled'].includes(status) ? status : ''
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
      if (!canViewAllRegions) effectiveCampus = (user && user.campus) || ''
    } else {
      effectiveCampus = ''
    }
    if (status) { where += ' AND e.status = ?'; params.push(status) }
    if (type) { where += ' AND e.type = ?'; params.push(type) }
    if (effectiveCampus) {
      const campuses = CAMPUS_GROUPS[effectiveCampus] || [effectiveCampus]
      where += ' AND e.campus IN (' + campuses.map(() => '?').join(', ') + ')'
      params.push(...campuses)
    } else if (!canViewAllRegions) {
      where += ' AND 1 = 0'
    }
    if (Number.isFinite(minPrice)) { where += ' AND e.reward >= ?'; params.push(minPrice) }
    if (Number.isFinite(maxPrice)) { where += ' AND e.reward <= ?'; params.push(maxPrice) }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM errand_order e ${where}`, params)
    const [rows] = await pool.query(
      `SELECT e.id, e.publisher_id, e.acceptor_id, e.type, e.title, e.reward, e.pickup_addr, e.delivery_addr,
        e.campus, e.gender_requirement, e.pickup_time_type, e.appointment_time, e.is_large_item,
        e.is_urgent, e.status, e.created_at, e.updated_at, u.nick_name AS publisher_name,
        a.nick_name AS acceptor_name,
        CASE WHEN e.publisher_id = ? OR e.acceptor_id = ? THEN e.description ELSE NULL END AS description,
        CASE WHEN e.publisher_id = ? OR e.acceptor_id = ? THEN e.remark ELSE NULL END AS remark
       FROM errand_order e
       LEFT JOIN sys_user u ON e.publisher_id = u.id
       LEFT JOIN sys_user a ON e.acceptor_id = a.id
       ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [userId, userId, userId, userId].concat(params, [pageSize, offset])
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
    const scheduledAt = new Date(String(body.appointmentTime || '').replace(' ', 'T'))
    if (!body.appointmentTime || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) return fail(res, '预约时间必须晚于当前时间')
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
    const [rows] = await conn.query("SELECT * FROM errand_order WHERE id = ? AND status = 'pending' AND payment_status = 'SUCCESS' FOR UPDATE", [req.params.id])
    if (!rows.length) { await conn.rollback(); return fail(res, '订单不存在或已被接单') }
    const order = rows[0]
    if (Number(order.publisher_id) === Number(req.userId)) { await conn.rollback(); return fail(res, '不能接自己的单') }
    await conn.query("UPDATE errand_order SET status = 'accepted', acceptor_id = ? WHERE id = ?", [req.userId, order.id])
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
  try {
    const [rows] = await pool.query("SELECT * FROM errand_order WHERE id = ? AND status = 'accepted'", [req.params.id])
    if (!rows.length) return fail(res, '订单状态不允许完成')
    const order = rows[0]
    if (![Number(order.publisher_id), Number(order.acceptor_id)].includes(Number(req.userId))) return fail(res, '无权完成订单', 403)
    const [result] = await pool.query("UPDATE errand_order SET status = 'finished' WHERE id = ? AND status = 'accepted'", [order.id])
    if (!result.affectedRows) return fail(res, '订单状态不允许完成')
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
  try {
    const [rows] = await pool.query("SELECT * FROM errand_order WHERE id = ? AND status IN ('pending', 'accepted')", [req.params.id])
    if (!rows.length) return fail(res, '订单状态不允许取消')
    const order = rows[0]
    if (Number(order.publisher_id) !== Number(req.userId)) return fail(res, '无权取消订单', 403)
    const [result] = await pool.query("UPDATE errand_order SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'accepted')", [order.id])
    if (!result.affectedRows) return fail(res, '订单状态不允许取消')
    if (order.acceptor_id) await notify(order.acceptor_id, '跑腿订单已取消', `“${order.title}”已被发布者取消`, order.id)
    success(res, null, '订单已取消')
  } catch (e) {
    fail(res, safeMessage(e), 500)
  }
}

async function listMine(req, res, field) {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, p.nick_name AS publisher_name, a.nick_name AS acceptor_name
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
      `SELECT e.*, p.nick_name AS publisher_name, a.nick_name AS acceptor_name
       FROM errand_order e LEFT JOIN sys_user p ON e.publisher_id = p.id LEFT JOIN sys_user a ON e.acceptor_id = a.id
       WHERE e.id = ? LIMIT 1`, [req.params.id]
    )
    if (!rows.length) return fail(res, '订单不存在', 404)
    const order = rows[0]
    const role = orderRole(order, req.userId)
    const canViewPrivate = role !== 'viewer'
    order.role = role
    if (!canViewPrivate) ['description', 'remark', 'receiver_name', 'receiver_phone', 'delivery_building', 'delivery_room'].forEach((key) => delete order[key])
    success(res, { order, canViewRemark: canViewPrivate })
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
