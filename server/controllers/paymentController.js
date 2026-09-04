const crypto = require('crypto')
const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')
const payConfig = require('../config/wechatPay')
const wechat = require('../services/wechatPayV3Service')
const { createNotification } = require('../services/notificationService')

const paidStates = ['SUCCESS', 'REFUNDED']
const toFen = (amount) => {
  const value = Number(amount)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0
}

async function repairForUser(conn, orderId, userId, lock) {
  const [rows] = await conn.query(
    `SELECT r.*, u.openid, p.id payment_id, p.amount_fen, p.status payment_status, p.merchant_order_no, p.wx_transaction_id, p.paid_at
     FROM repair_order r JOIN sys_user u ON u.id = r.user_id
     LEFT JOIN payment_transaction p ON p.business_type = 'repair' AND p.business_order_id = r.id
     WHERE r.id = ? AND r.user_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [orderId, userId],
  )
  return rows[0]
}

async function errandForUser(conn, orderId, userId, lock) {
  const [rows] = await conn.query(
    `SELECT e.*, u.openid, p.id payment_id, p.amount_fen, p.status transaction_status,
      p.merchant_order_no, p.wx_transaction_id, p.paid_at AS transaction_paid_at
     FROM errand_order e JOIN sys_user u ON u.id = e.publisher_id
     LEFT JOIN payment_transaction p ON p.business_type = 'errand' AND p.business_order_id = e.id
     WHERE e.id = ? AND e.publisher_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [orderId, userId],
  )
  return rows[0]
}

function makeErrandOrderNo(orderId) {
  return `ER${Date.now().toString().slice(-10)}${String(orderId).padStart(6, '0')}`
}

async function settlePayment(resource, source) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [payments] = await conn.query('SELECT * FROM payment_transaction WHERE merchant_order_no = ? FOR UPDATE', [resource.out_trade_no])
    if (!payments.length) throw new Error('Unknown merchant order')
    const payment = payments[0]
    if (resource.appid !== payConfig.appId || resource.mchid !== payConfig.mchId || !resource.amount || Number(resource.amount.total) !== Number(payment.amount_fen)) throw new Error('Payment callback validation failed')
    let order
    let amountFen
    if (payment.business_type === 'repair') {
      const [orders] = await conn.query('SELECT * FROM repair_order WHERE id = ? FOR UPDATE', [payment.business_order_id])
      order = orders[0]
      amountFen = order && toFen(order.amount)
    } else if (payment.business_type === 'errand') {
      const [orders] = await conn.query('SELECT * FROM errand_order WHERE id = ? FOR UPDATE', [payment.business_order_id])
      order = orders[0]
      amountFen = order && toFen(order.reward)
    } else {
      throw new Error('Unsupported payment business type')
    }
    if (!order || amountFen !== Number(payment.amount_fen)) throw new Error('Business order validation failed')
    const firstSettlement = payment.status !== 'SUCCESS'
    if (firstSettlement) {
      await conn.query("UPDATE payment_transaction SET status = 'SUCCESS', wx_transaction_id = ?, paid_at = NOW(), callback_source = ?, last_error = NULL WHERE id = ?", [resource.transaction_id || null, source, payment.id])
      if (payment.business_type === 'repair') {
        await conn.query("UPDATE repair_order SET status = 'paid', transaction_id = ?, paid_at = NOW() WHERE id = ? AND status = 'unpaid'", [resource.transaction_id || null, order.id])
      } else {
        await conn.query("UPDATE errand_order SET payment_status = 'SUCCESS', transaction_id = ?, paid_at = NOW() WHERE id = ? AND payment_status <> 'SUCCESS'", [resource.transaction_id || null, order.id])
      }
    }
    const refundCancelledErrand = firstSettlement && payment.business_type === 'errand' && order.status === 'cancelled'
    await conn.commit()
    if (refundCancelledErrand) refundCancelledErrandPayment(payment.id).catch((error) => console.error('[cancelled-errand-refund]', safeMessage(error)))
    if (firstSettlement && payment.business_type === 'repair') await notifyRepairTechnician(order)
    return payment
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { conn.release() }
}

async function notifyRepairTechnician(order) {
  try {
    const [rows] = await pool.query('SELECT id FROM sys_user WHERE (id = ? OR phone = ?) AND status = 1 LIMIT 1', [order.technician_user_id || 0, order.technician_phone || ''])
    if (!rows.length) return
    await createNotification({ userId: rows[0].id, type: 'repair', title: 'New paid repair order', content: `Order ${order.order_no} has been paid and awaits acceptance.`, relatedId: order.id })
    await pool.query('UPDATE repair_order SET technician_user_id = ?, technician_notified_at = NOW(), notified_at = NOW() WHERE id = ? AND technician_notified_at IS NULL', [rows[0].id, order.id])
  } catch (error) {
    // A notification failure must never roll back a verified financial settlement.
    console.error('[payment-technician-notify]', safeMessage(error))
  }
}

exports.createRepairPayment = async (req, res) => {
  const orderId = Number(req.params.id)
  if (!Number.isInteger(orderId) || orderId < 1) return fail(res, 'Invalid order id')
  const conn = await pool.getConnection()
  let order
  try {
    await conn.beginTransaction()
    order = await repairForUser(conn, orderId, req.userId, true)
    if (!order) { await conn.rollback(); return fail(res, 'Order not found', 404) }
    if (order.status !== 'unpaid') { await conn.rollback(); return fail(res, order.status === 'paid' ? 'Order is already paid' : 'Order is not payable', 409) }
    if (!order.openid || !toFen(order.amount)) { await conn.rollback(); return fail(res, 'Order payment information is incomplete', 422) }
    if (!order.payment_id) await conn.query("INSERT INTO payment_transaction (business_type, business_order_id, merchant_order_no, user_id, amount_fen, status) VALUES ('repair', ?, ?, ?, ?, 'CREATED')", [order.id, order.order_no, req.userId, toFen(order.amount)])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    return fail(res, safeMessage(error), 500)
  } finally { conn.release() }
  try {
    const params = await wechat.createJsapiPayment({ orderNo: order.order_no, description: `Campus repair - ${order.device_type}`, amountFen: toFen(order.amount), openid: order.openid })
    await pool.query("UPDATE payment_transaction SET status = 'PREPAY', prepay_id = ?, last_error = NULL WHERE business_type = 'repair' AND business_order_id = ? AND status IN ('CREATED', 'PREPAY')", [params.prepayId, order.id])
    delete params.prepayId
    success(res, params)
  } catch (error) {
    await pool.query("UPDATE payment_transaction SET last_error = ? WHERE business_type = 'repair' AND business_order_id = ? AND status IN ('CREATED', 'PREPAY')", [safeMessage(error).slice(0, 500), order.id]).catch(() => {})
    fail(res, 'Unable to create WeChat payment. Please try again later.', 502)
  }
}

exports.queryRepairPaymentStatus = async (req, res) => {
  const orderId = Number(req.params.id)
  if (!Number.isInteger(orderId) || orderId < 1) return fail(res, 'Invalid order id')
  try {
    let order = await repairForUser(pool, orderId, req.userId, false)
    if (!order) return fail(res, 'Order not found', 404)
    if (order.payment_id && !paidStates.includes(order.payment_status)) {
      const remote = await wechat.queryTransaction(order.order_no)
      if (remote.trade_state === 'SUCCESS') await settlePayment(remote, 'query')
      else if (remote.trade_state === 'CLOSED') await pool.query("UPDATE payment_transaction SET status = 'CLOSED' WHERE id = ? AND status <> 'SUCCESS'", [order.payment_id])
      order = await repairForUser(pool, orderId, req.userId, false)
    }
    success(res, { status: order.payment_status || 'UNPAID', amount: Number(order.amount).toFixed(2), paidAt: order.paid_at || null, transactionId: order.wx_transaction_id || '' })
  } catch (error) { fail(res, 'Unable to query payment status', 502) }
}

exports.createErrandPayment = async (req, res) => {
  const orderId = Number(req.params.id)
  if (!Number.isInteger(orderId) || orderId < 1) return fail(res, 'Invalid order id')
  const conn = await pool.getConnection()
  let order
  try {
    await conn.beginTransaction()
    order = await errandForUser(conn, orderId, req.userId, true)
    if (!order) { await conn.rollback(); return fail(res, 'Order not found', 404) }
    if (order.payment_status === 'SUCCESS') { await conn.rollback(); return fail(res, 'Order is already paid', 409) }
    if (!order.openid || !toFen(order.reward)) { await conn.rollback(); return fail(res, 'Order payment information is incomplete', 422) }
    if (!order.order_no) {
      order.order_no = makeErrandOrderNo(order.id)
      await conn.query('UPDATE errand_order SET order_no = ? WHERE id = ?', [order.order_no, order.id])
    }
    if (!order.payment_id) {
      await conn.query("INSERT INTO payment_transaction (business_type, business_order_id, merchant_order_no, user_id, amount_fen, status) VALUES ('errand', ?, ?, ?, ?, 'CREATED')", [order.id, order.order_no, req.userId, toFen(order.reward)])
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    return fail(res, safeMessage(error), 500)
  } finally { conn.release() }

  try {
    const params = await wechat.createJsapiPayment({ orderNo: order.order_no, description: `Campus errand - ${order.type}`, amountFen: toFen(order.reward), openid: order.openid })
    await pool.query("UPDATE payment_transaction SET status = 'PREPAY', prepay_id = ?, last_error = NULL WHERE business_type = 'errand' AND business_order_id = ? AND status IN ('CREATED', 'PREPAY')", [params.prepayId, order.id])
    await pool.query("UPDATE errand_order SET payment_status = 'PREPAY' WHERE id = ? AND payment_status = 'UNPAID'", [order.id])
    delete params.prepayId
    success(res, params)
  } catch (error) {
    await pool.query("UPDATE payment_transaction SET last_error = ? WHERE business_type = 'errand' AND business_order_id = ? AND status IN ('CREATED', 'PREPAY')", [safeMessage(error).slice(0, 500), order.id]).catch(() => {})
    fail(res, 'Unable to create WeChat payment. Please try again later.', 502)
  }
}

exports.queryErrandPaymentStatus = async (req, res) => {
  const orderId = Number(req.params.id)
  if (!Number.isInteger(orderId) || orderId < 1) return fail(res, 'Invalid order id')
  try {
    let order = await errandForUser(pool, orderId, req.userId, false)
    if (!order) return fail(res, 'Order not found', 404)
    if (order.payment_id && !paidStates.includes(order.transaction_status)) {
      const remote = await wechat.queryTransaction(order.order_no)
      if (remote.trade_state === 'SUCCESS') await settlePayment(remote, 'query')
      else if (remote.trade_state === 'CLOSED') await pool.query("UPDATE payment_transaction SET status = 'CLOSED' WHERE id = ? AND status <> 'SUCCESS'", [order.payment_id])
      order = await errandForUser(pool, orderId, req.userId, false)
    }
    success(res, { status: order.transaction_status || order.payment_status || 'UNPAID', amount: Number(order.reward).toFixed(2), paidAt: order.transaction_paid_at || order.paid_at || null, transactionId: order.wx_transaction_id || order.transaction_id || '' })
  } catch (error) { fail(res, 'Unable to query payment status', 502) }
}

exports.paymentNotify = async (req, res) => {
  try {
    if (!req.rawBody || !wechat.verifyCallback(req.headers, req.rawBody)) return res.status(401).json({ code: 'FAIL', message: 'Signature verification failed' })
    const resource = wechat.decryptResource(req.body && req.body.resource)
    if (resource.trade_state === 'SUCCESS') await settlePayment(resource, 'notify')
    res.status(200).json({ code: 'SUCCESS', message: 'OK' })
  } catch (error) {
    console.error('[payment-notify]', safeMessage(error))
    res.status(500).json({ code: 'FAIL', message: 'Retry later' })
  }
}

async function updateRefundState(refundId, state, wxRefundId) {
  await pool.query("UPDATE payment_refund SET status = ?, wx_refund_id = COALESCE(?, wx_refund_id), completed_at = CASE WHEN ? = 'SUCCESS' THEN NOW() ELSE completed_at END WHERE id = ?", [state, wxRefundId || null, state, refundId])
  if (state !== 'SUCCESS') return
  const [[refund]] = await pool.query('SELECT payment_id FROM payment_refund WHERE id = ?', [refundId])
  if (!refund) return
  const [[amounts]] = await pool.query("SELECT p.amount_fen, IFNULL(SUM(CASE WHEN r.status = 'SUCCESS' THEN r.refund_fen ELSE 0 END), 0) refunded FROM payment_transaction p LEFT JOIN payment_refund r ON r.payment_id = p.id WHERE p.id = ? GROUP BY p.id", [refund.payment_id])
  if (!amounts || Number(amounts.refunded) < Number(amounts.amount_fen)) return
  await pool.query("UPDATE payment_transaction SET status = 'REFUNDED' WHERE id = ?", [refund.payment_id])
  await pool.query("UPDATE errand_order e JOIN payment_transaction p ON p.business_type = 'errand' AND p.business_order_id = e.id SET e.payment_status = 'REFUNDED' WHERE p.id = ?", [refund.payment_id])
}

async function reserveErrandRefund(orderId, userId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query(
      `SELECT e.*, p.id payment_id, p.amount_fen, p.status transaction_status, p.merchant_order_no, p.wx_transaction_id
       FROM errand_order e LEFT JOIN payment_transaction p ON p.business_type = 'errand' AND p.business_order_id = e.id
       WHERE e.id = ? AND e.publisher_id = ? FOR UPDATE`,
      [orderId, userId]
    )
    const order = rows[0]
    if (!order || !['pending', 'accepted', 'cancelled'].includes(order.status)) { await conn.rollback(); return { error: 'Order is not cancellable', code: 409 } }
    if (order.status !== 'cancelled') await conn.query("UPDATE errand_order SET status = 'cancelled' WHERE id = ?", [order.id])
    if (!order.payment_id || order.transaction_status !== 'SUCCESS') {
      await conn.commit()
      return { order, refund: null }
    }
    const [[existing]] = await conn.query("SELECT * FROM payment_refund WHERE payment_id = ? AND status IN ('CREATED','PROCESSING','SUCCESS') ORDER BY id DESC LIMIT 1 FOR UPDATE", [order.payment_id])
    if (existing) {
      await conn.query("UPDATE errand_order SET payment_status = 'REFUNDING' WHERE id = ? AND payment_status <> 'REFUNDED'", [order.id])
      await conn.query("UPDATE payment_transaction SET status = 'REFUNDING' WHERE id = ? AND status <> 'REFUNDED'", [order.payment_id])
      await conn.commit()
      return { order, refund: { id: existing.id, outRefundNo: existing.out_refund_no, pending: true } }
    }
    const outRefundNo = `RF${Date.now()}${crypto.randomBytes(3).toString('hex')}`
    const [result] = await conn.query("INSERT INTO payment_refund (payment_id, out_refund_no, refund_fen, reason, status) VALUES (?, ?, ?, 'Order cancelled', 'CREATED')", [order.payment_id, outRefundNo, order.amount_fen])
    await conn.query("UPDATE payment_transaction SET status = 'REFUNDING' WHERE id = ?", [order.payment_id])
    await conn.query("UPDATE errand_order SET payment_status = 'REFUNDING' WHERE id = ?", [order.id])
    await conn.commit()
    return { order, refund: { id: result.insertId, outRefundNo, paymentId: order.payment_id, amountFen: Number(order.amount_fen), transactionId: order.wx_transaction_id, orderNo: order.merchant_order_no } }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { conn.release() }
}

async function submitErrandRefund(refund) {
  if (!refund || refund.pending) return refund
  try {
    const remote = await wechat.createRefund({ transactionId: refund.transactionId, outTradeNo: refund.orderNo, outRefundNo: refund.outRefundNo, reason: 'Order cancelled', totalFen: refund.amountFen, refundFen: refund.amountFen })
    const state = remote.status || 'PROCESSING'
    await updateRefundState(refund.id, state, remote.refund_id)
    return { ...refund, status: state }
  } catch (error) {
    await pool.query("UPDATE payment_refund SET status = 'FAILED', last_error = ? WHERE id = ?", [safeMessage(error).slice(0, 500), refund.id]).catch(() => {})
    await pool.query("UPDATE payment_transaction SET status = 'SUCCESS' WHERE id = ? AND status = 'REFUNDING'", [refund.paymentId]).catch(() => {})
    await pool.query("UPDATE errand_order e JOIN payment_transaction p ON p.business_type = 'errand' AND p.business_order_id = e.id SET e.payment_status = 'SUCCESS' WHERE p.id = ?", [refund.paymentId]).catch(() => {})
    throw error
  }
}

async function refundCancelledErrandPayment(paymentId) {
  const [[payment]] = await pool.query("SELECT p.*, e.publisher_id, e.id order_id FROM payment_transaction p JOIN errand_order e ON p.business_type = 'errand' AND p.business_order_id = e.id WHERE p.id = ? AND e.status = 'cancelled'", [paymentId])
  if (!payment || payment.status !== 'SUCCESS') return
  const reserved = await reserveErrandRefund(payment.order_id, payment.publisher_id)
  if (reserved.refund) await submitErrandRefund(reserved.refund)
}

exports.cancelErrand = async (req, res) => {
  const orderId = Number(req.params.id)
  if (!Number.isInteger(orderId) || orderId < 1) return fail(res, 'Invalid order id')
  try {
    const reserved = await reserveErrandRefund(orderId, req.userId)
    if (reserved.error) return fail(res, reserved.error, reserved.code)
    if (!reserved.refund) return success(res, { refundStatus: null }, 'Order cancelled')
    const refund = await submitErrandRefund(reserved.refund)
    success(res, { refundStatus: refund.status || 'PROCESSING', refundId: refund.id }, 'Order cancelled and refund started')
  } catch (error) {
    fail(res, 'Order cancelled, but automatic refund could not be started', 502)
  }
}

exports.createRefund = async (req, res) => {
  const paymentId = Number(req.params.id); const refundFen = toFen(req.body && req.body.amount); const reason = String((req.body && req.body.reason) || 'Merchant refund').trim().slice(0, 80)
  if (!Number.isInteger(paymentId) || paymentId < 1 || !refundFen) return fail(res, 'Invalid refund request')
  const conn = await pool.getConnection(); let payment; let refund
  try {
    await conn.beginTransaction()
    const [payments] = await conn.query('SELECT * FROM payment_transaction WHERE id = ? FOR UPDATE', [paymentId]); payment = payments[0]
    if (!payment || payment.status !== 'SUCCESS') { await conn.rollback(); return fail(res, 'Only successful payments can be refunded', 409) }
    const [[row]] = await conn.query("SELECT IFNULL(SUM(CASE WHEN status IN ('SUCCESS','PROCESSING','CREATED') THEN refund_fen ELSE 0 END), 0) amount FROM payment_refund WHERE payment_id = ?", [paymentId])
    if (refundFen + Number(row.amount) > Number(payment.amount_fen)) { await conn.rollback(); return fail(res, 'Refund amount exceeds remaining paid amount', 422) }
    const outRefundNo = `RF${Date.now()}${crypto.randomBytes(3).toString('hex')}`
    const [result] = await conn.query("INSERT INTO payment_refund (payment_id, out_refund_no, refund_fen, reason, status) VALUES (?, ?, ?, ?, 'CREATED')", [paymentId, outRefundNo, refundFen, reason])
    refund = { id: result.insertId, outRefundNo }; await conn.commit()
  } catch (error) { await conn.rollback(); return fail(res, safeMessage(error), 500) } finally { conn.release() }
  try {
    const remote = await wechat.createRefund({ transactionId: payment.wx_transaction_id, outTradeNo: payment.merchant_order_no, outRefundNo: refund.outRefundNo, reason, totalFen: Number(payment.amount_fen), refundFen })
    await pool.query('UPDATE payment_refund SET status = ?, wx_refund_id = ? WHERE id = ?', [remote.status || 'PROCESSING', remote.refund_id || null, refund.id])
    success(res, { id: refund.id, outRefundNo: refund.outRefundNo, status: remote.status || 'PROCESSING' })
  } catch (error) { await pool.query("UPDATE payment_refund SET status = 'FAILED', last_error = ? WHERE id = ?", [safeMessage(error).slice(0, 500), refund.id]).catch(() => {}); fail(res, 'Unable to create refund', 502) }
}

exports.queryRefund = async (req, res) => {
  const refundId = Number(req.params.refundId)
  if (!Number.isInteger(refundId) || refundId < 1) return fail(res, 'Invalid refund id')
  try {
    const [[refund]] = await pool.query('SELECT * FROM payment_refund WHERE id = ?', [refundId]); if (!refund) return fail(res, 'Refund not found', 404)
    const remote = await wechat.queryRefund(refund.out_refund_no)
    await updateRefundState(refund.id, remote.status, remote.refund_id)
    success(res, { id: refund.id, outRefundNo: refund.out_refund_no, status: remote.status, amount: Number(refund.refund_fen) / 100 })
  } catch (error) { fail(res, 'Unable to query refund status', 502) }
}

exports.refundNotify = async (req, res) => {
  try {
    if (!req.rawBody || !wechat.verifyCallback(req.headers, req.rawBody)) return res.status(401).json({ code: 'FAIL', message: 'Signature verification failed' })
    const resource = wechat.decryptResource(req.body && req.body.resource); const state = resource.refund_status || resource.status
    const [[refund]] = await pool.query('SELECT id FROM payment_refund WHERE out_refund_no = ?', [resource.out_refund_no])
    if (refund) await updateRefundState(refund.id, state, resource.refund_id)
    res.status(200).json({ code: 'SUCCESS', message: 'OK' })
  } catch (error) { res.status(500).json({ code: 'FAIL', message: 'Retry later' }) }
}

exports.listPayments = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)); const offset = (page - 1) * pageSize
  try {
    const [[count], [list]] = await Promise.all([pool.query('SELECT COUNT(*) total FROM payment_transaction'), pool.query('SELECT id, business_type businessType, business_order_id businessOrderId, merchant_order_no orderNo, user_id userId, amount_fen amountFen, status, wx_transaction_id transactionId, paid_at paidAt, created_at createdAt FROM payment_transaction ORDER BY id DESC LIMIT ? OFFSET ?', [pageSize, offset])])
    success(res, { list, total: Number(count.total), page, hasMore: offset + list.length < Number(count.total) })
  } catch (error) { fail(res, safeMessage(error), 500) }
}

exports.settlePayment = settlePayment
