const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')
const { createNotification } = require('../services/notificationService')
const wechat = require('../services/wechatPayV3Service')

function toFen(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

async function totals(conn, userId, lock) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const [[earnings]] = await conn.query(`SELECT IFNULL(SUM(amount_fen), 0) amount FROM wallet_ledger WHERE user_id = ?${suffix}`, [userId])
  const [[reserved]] = await conn.query(`SELECT IFNULL(SUM(amount_fen), 0) amount FROM wallet_withdrawal WHERE user_id = ? AND status IN ('PENDING', 'PROCESSING')${suffix}`, [userId])
  return { earnedFen: Number(earnings.amount), reservedFen: Number(reserved.amount) }
}

function walletData(values) {
  return {
    earned: values.earnedFen / 100,
    withdrawing: values.reservedFen / 100,
    available: Math.max(0, values.earnedFen - values.reservedFen) / 100
  }
}

exports.summary = async (req, res) => {
  try {
    const amount = await totals(pool, req.userId, false)
    const [records] = await pool.query(`
      SELECT id, 'earning' record_type, amount_fen, title, 'SUCCESS' status, created_at
      FROM wallet_ledger WHERE user_id = ?
      UNION ALL
      SELECT id, 'withdrawal' record_type, -amount_fen, 'Withdrawal to WeChat', status, created_at
      FROM wallet_withdrawal WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 100`, [req.userId, req.userId])
    success(res, { ...walletData(amount), records: records.map((item) => ({
      id: `${item.record_type}-${item.id}`,
      type: item.record_type,
      amount: Number(item.amount_fen) / 100,
      title: item.title,
      status: item.status,
      createdAt: item.created_at
    })) })
  } catch (error) { fail(res, safeMessage(error), 500) }
}

exports.requestWithdrawal = async (req, res) => {
  const amountFen = toFen((req.body || {}).amount)
  if (amountFen < 100) return fail(res, 'Minimum withdrawal is 1 yuan')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const amount = await totals(conn, req.userId, true)
    if (amountFen > amount.earnedFen - amount.reservedFen) {
      await conn.rollback()
      return fail(res, 'Insufficient available balance', 422)
    }
    const token = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase()
    const [result] = await conn.query(
      "INSERT INTO wallet_withdrawal (user_id, amount_fen, out_batch_no, out_detail_no) VALUES (?, ?, ?, ?)",
      [req.userId, amountFen, `WD${token}`.slice(0, 64), `WDD${token}`.slice(0, 64)]
    )
    await conn.commit()
    success(res, { id: result.insertId, status: 'PENDING', available: (amount.earnedFen - amount.reservedFen - amountFen) / 100 }, 'Withdrawal submitted')
  } catch (error) {
    await conn.rollback()
    fail(res, safeMessage(error), 500)
  } finally { conn.release() }
}

exports.listWithdrawals = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30))
  const status = String(req.query.status || '').trim()
  const offset = (page - 1) * pageSize
  const statuses = ['PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FAILED']
  if (status && !statuses.includes(status)) return fail(res, 'Invalid withdrawal status')
  const where = status ? 'WHERE w.status = ?' : ''
  const params = status ? [status] : []
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM wallet_withdrawal w ${where}`, params),
      pool.query(`SELECT w.id, w.user_id userId, u.nick_name nickName, w.amount_fen amountFen, w.status, w.review_note reviewNote, w.created_at createdAt, w.reviewed_at reviewedAt FROM wallet_withdrawal w JOIN sys_user u ON u.id = w.user_id ${where} ORDER BY w.id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    success(res, { list: list.map((item) => ({ ...item, amount: Number(item.amountFen) / 100 })), total: Number(count.total), page, hasMore: offset + list.length < Number(count.total) })
  } catch (error) { fail(res, safeMessage(error), 500) }
}

exports.reviewWithdrawal = async (req, res) => {
  const id = Number(req.params.id)
  const action = String((req.body || {}).action || '')
  const note = String((req.body || {}).note || '').trim().slice(0, 255)
  if (!Number.isInteger(id) || id < 1 || !['approve', 'reject'].includes(action)) return fail(res, 'Invalid withdrawal review')
  const conn = await pool.getConnection()
  let withdrawal
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query(`SELECT w.*, u.openid FROM wallet_withdrawal w JOIN sys_user u ON u.id = w.user_id WHERE w.id = ? FOR UPDATE`, [id])
    withdrawal = rows[0]
    if (!withdrawal || withdrawal.status !== 'PENDING') { await conn.rollback(); return fail(res, 'Withdrawal is no longer pending', 409) }
    if (action === 'reject') {
      await conn.query("UPDATE wallet_withdrawal SET status = 'REJECTED', review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?", [note, req.userId, id])
      await conn.commit()
      await writeAdminAudit(req, 'wallet.withdrawal.reject', 'wallet_withdrawal', id, { note })
      await createNotification({ userId: withdrawal.user_id, type: 'system', title: 'Withdrawal rejected', content: note || 'Your withdrawal request was rejected.', relatedId: id })
      return success(res, { status: 'REJECTED' })
    }
    if (!withdrawal.openid) { await conn.rollback(); return fail(res, 'User WeChat account is unavailable', 422) }
    await conn.query("UPDATE wallet_withdrawal SET status = 'PROCESSING', review_note = ?, reviewed_by = ?, reviewed_at = NOW(), last_error = NULL WHERE id = ?", [note, req.userId, id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    return fail(res, safeMessage(error), 500)
  } finally { conn.release() }

  try {
    const remote = await wechat.createTransferBatch({
      outBatchNo: withdrawal.out_batch_no,
      outDetailNo: withdrawal.out_detail_no,
      amountFen: Number(withdrawal.amount_fen),
      openid: withdrawal.openid,
      remark: 'Campus wallet withdrawal'
    })
    const remoteStatus = remote.batch_status || 'PROCESSING'
    const status = remoteStatus === 'FINISHED' ? 'SUCCESS' : remoteStatus === 'CLOSED' ? 'FAILED' : 'PROCESSING'
    await pool.query("UPDATE wallet_withdrawal SET status = ?, wx_batch_id = ?, completed_at = CASE WHEN ? = 'SUCCESS' THEN NOW() ELSE NULL END WHERE id = ?", [status, remote.batch_id || null, status, id])
    await writeAdminAudit(req, 'wallet.withdrawal.approve', 'wallet_withdrawal', id, { amountFen: Number(withdrawal.amount_fen), remoteStatus })
    await createNotification({ userId: withdrawal.user_id, type: 'system', title: status === 'SUCCESS' ? 'Withdrawal paid' : 'Withdrawal processing', content: status === 'SUCCESS' ? 'Your withdrawal has been sent to your WeChat wallet.' : 'Your withdrawal has been submitted to WeChat for processing.', relatedId: id })
    success(res, { status })
  } catch (error) {
    await pool.query("UPDATE wallet_withdrawal SET status = 'PENDING', last_error = ? WHERE id = ? AND status = 'PROCESSING'", [safeMessage(error).slice(0, 500), id]).catch(() => {})
    fail(res, 'Unable to start WeChat transfer', 502)
  }
}

exports.transferNotify = async (req, res) => {
  try {
    if (!req.rawBody || !wechat.verifyCallback(req.headers, req.rawBody)) return res.status(401).json({ code: 'FAIL', message: 'Signature verification failed' })
    const resource = wechat.decryptResource(req.body && req.body.resource)
    const remoteStatus = resource.batch_status || resource.status || 'PROCESSING'
    const status = remoteStatus === 'FINISHED' ? 'SUCCESS' : remoteStatus === 'CLOSED' ? 'FAILED' : 'PROCESSING'
    const [result] = await pool.query("UPDATE wallet_withdrawal SET status = ?, wx_batch_id = COALESCE(?, wx_batch_id), completed_at = CASE WHEN ? = 'SUCCESS' THEN NOW() ELSE completed_at END WHERE out_batch_no = ?", [status, resource.batch_id || null, status, resource.out_batch_no])
    if (result.affectedRows) {
      const [[withdrawal]] = await pool.query('SELECT user_id FROM wallet_withdrawal WHERE out_batch_no = ?', [resource.out_batch_no])
      if (withdrawal && status === 'SUCCESS') await createNotification({ userId: withdrawal.user_id, type: 'system', title: 'Withdrawal paid', content: 'Your withdrawal has been sent to your WeChat wallet.', relatedId: resource.out_batch_no })
    }
    res.status(200).json({ code: 'SUCCESS', message: 'OK' })
  } catch (error) {
    console.error('[wallet-transfer-notify]', safeMessage(error))
    res.status(500).json({ code: 'FAIL', message: 'Retry later' })
  }
}
