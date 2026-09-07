const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')
const { createNotification } = require('../services/notificationService')
const wechat = require('../services/wechatPayV3Service')
const payConfig = require('../config/wechatPay')

function toFen(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

async function totals(conn, userId, lock) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const [[earnings]] = await conn.query(`SELECT IFNULL(SUM(amount_fen), 0) amount FROM wallet_ledger WHERE user_id = ?${suffix}`, [userId])
  const [[reserved]] = await conn.query(`SELECT IFNULL(SUM(amount_fen), 0) amount FROM wallet_withdrawal WHERE user_id = ? AND status IN ('PENDING', 'PROCESSING', 'WAIT_CONFIRM')${suffix}`, [userId])
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
      SELECT l.id, 'earning' record_type, l.amount_fen, l.title, 'SUCCESS' status, l.created_at, o.title order_title
      FROM wallet_ledger l
      LEFT JOIN errand_order o ON l.reference_type = 'errand_order' AND o.id = l.reference_id
      WHERE l.user_id = ?
      UNION ALL
      SELECT id, 'withdrawal' record_type, -amount_fen, '提现到微信零钱', status, created_at, NULL
      FROM wallet_withdrawal WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 100`, [req.userId, req.userId])
    success(res, { ...walletData(amount), records: records.map((item) => ({
      id: `${item.record_type}-${item.id}`,
      refId: item.id,
      type: item.record_type,
      amount: Number(item.amount_fen) / 100,
      title: item.title,
      orderTitle: item.order_title || '',
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
  const statuses = ['PENDING', 'PROCESSING', 'WAIT_CONFIRM', 'SUCCESS', 'REJECTED', 'FAILED']
  if (status && !statuses.includes(status)) return fail(res, 'Invalid withdrawal status')
  const where = status ? 'WHERE w.status = ?' : ''
  const params = status ? [status] : []
  try {
    const [[count], [list]] = await Promise.all([
      pool.query(`SELECT COUNT(*) total FROM wallet_withdrawal w ${where}`, params),
      pool.query(`SELECT w.id, w.user_id userId, u.nick_name nickName, u.phone phone, w.amount_fen amountFen, w.status, w.review_note reviewNote, w.created_at createdAt, w.reviewed_at reviewedAt FROM wallet_withdrawal w JOIN sys_user u ON u.id = w.user_id ${where} ORDER BY w.id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
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
    // 微信商家转账未配置（本地/测试环境）：直接标记通过并模拟到账，避免审核被转账配置阻塞
    if (!wechat.isConfigured()) {
      await conn.query(
        "UPDATE wallet_withdrawal SET status = 'SUCCESS', review_note = ?, reviewed_by = ?, reviewed_at = NOW(), completed_at = NOW(), last_error = NULL WHERE id = ?",
        [note, req.userId, id]
      )
      await conn.commit()
      await writeAdminAudit(req, 'wallet.withdrawal.approve', 'wallet_withdrawal', id, { amountFen: Number(withdrawal.amount_fen), mode: 'test', note })
      await createNotification({ userId: withdrawal.user_id, type: 'system', title: 'Withdrawal paid', content: 'Your withdrawal has been approved.', relatedId: id })
      return success(res, { status: 'SUCCESS', mode: 'test' })
    }
    await conn.query("UPDATE wallet_withdrawal SET status = 'PROCESSING', review_note = ?, reviewed_by = ?, reviewed_at = NOW(), last_error = NULL WHERE id = ?", [note, req.userId, id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    return fail(res, safeMessage(error), 500)
  } finally { conn.release() }

  try {
    // 优先走新版「商家转账（用户确认收款）」接口：2025-01-15 后开通的商户号只支持新版
    let bill = null
    try {
      bill = await wechat.createTransferBill({
        outBillNo: withdrawal.out_batch_no,
        amountFen: Number(withdrawal.amount_fen),
        openid: withdrawal.openid,
        remark: 'Campus wallet withdrawal'
      })
    } catch (billError) {
      // 商户号若仍是旧版「商家转账到零钱」产品（报 NO_AUTH 无新版权限），回退旧批量转账接口
      if (billError.wxCode !== 'NO_AUTH') throw billError
    }
    if (!bill) {
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
      await writeAdminAudit(req, 'wallet.withdrawal.approve', 'wallet_withdrawal', id, { amountFen: Number(withdrawal.amount_fen), mode: 'legacy-batch', remoteStatus })
      await createNotification({ userId: withdrawal.user_id, type: 'system', title: status === 'SUCCESS' ? 'Withdrawal paid' : 'Withdrawal processing', content: status === 'SUCCESS' ? 'Your withdrawal has been sent to your WeChat wallet.' : 'Your withdrawal has been submitted to WeChat for processing.', relatedId: id })
      return success(res, { status })
    }
    const remoteState = bill.state || ''
    // WAIT_USER_CONFIRM / TRANSFERING / ACCEPTED / PROCESSING 都可拉起收款确认页
    const confirmable = ['WAIT_USER_CONFIRM', 'TRANSFERING', 'ACCEPTED', 'PROCESSING']
    const status = remoteState === 'SUCCESS' ? 'SUCCESS' : ['FAIL', 'CANCELLED'].includes(remoteState) ? 'FAILED' : confirmable.includes(remoteState) ? 'WAIT_CONFIRM' : 'PROCESSING'
    await pool.query(
      "UPDATE wallet_withdrawal SET status = ?, transfer_bill_no = COALESCE(?, transfer_bill_no), package_info = COALESCE(?, package_info), completed_at = CASE WHEN ? = 'SUCCESS' THEN NOW() ELSE completed_at END WHERE id = ?",
      [status, bill.transfer_bill_no || null, bill.package_info || null, status, id]
    )
    await writeAdminAudit(req, 'wallet.withdrawal.approve', 'wallet_withdrawal', id, { amountFen: Number(withdrawal.amount_fen), mode: 'mch-transfer', remoteState })
    await createNotification({
      userId: withdrawal.user_id, type: 'system',
      title: status === 'SUCCESS' ? 'Withdrawal paid' : 'Withdrawal awaiting confirmation',
      content: status === 'SUCCESS' ? 'Your withdrawal has been sent to your WeChat wallet.' : '管理员已通过你的提现申请，请在「钱包-收益明细」中点击「确认收款」完成提现（24小时内有效）。',
      relatedId: id
    })
    success(res, { status })
  } catch (error) {
    // 把微信返回的真实错误（如 NO_AUTH / NOT_ENOUGH / openid 错误）透出，方便管理员定位
    console.error('[wallet-withdraw-transfer]', safeMessage(error))
    await pool.query("UPDATE wallet_withdrawal SET status = 'PENDING', last_error = ? WHERE id = ? AND status = 'PROCESSING'", [safeMessage(error).slice(0, 500), id]).catch(() => {})
    fail(res, safeMessage(error), 502)
  }
}

exports.transferNotify = async (req, res) => {
  try {
    if (!req.rawBody || !wechat.verifyCallback(req.headers, req.rawBody)) return res.status(401).json({ code: 'FAIL', message: 'Signature verification failed' })
    const resource = wechat.decryptResource(req.body && req.body.resource)
    // 新版商家转账（用户确认收款）回调：资源含 out_bill_no / state / fail_reason
    if (resource.out_bill_no) {
      const stateMap = { SUCCESS: 'SUCCESS', FAIL: 'FAILED', CANCELLED: 'FAILED' }
      const status = stateMap[resource.state] || 'WAIT_CONFIRM'
      const [result] = await pool.query(
        "UPDATE wallet_withdrawal SET status = ?, transfer_bill_no = COALESCE(?, transfer_bill_no), completed_at = CASE WHEN ? = 'SUCCESS' THEN NOW() ELSE completed_at END, last_error = ? WHERE out_batch_no = ?",
        [status, resource.transfer_bill_no || null, status, status === 'FAILED' ? String(resource.fail_reason || '转账失败').slice(0, 500) : null, resource.out_bill_no]
      )
      if (result.affectedRows && status === 'SUCCESS') {
        const [[withdrawal]] = await pool.query('SELECT user_id FROM wallet_withdrawal WHERE out_batch_no = ?', [resource.out_bill_no])
        if (withdrawal) await createNotification({ userId: withdrawal.user_id, type: 'system', title: 'Withdrawal paid', content: 'Your withdrawal has been sent to your WeChat wallet.', relatedId: resource.out_bill_no })
      }
      return res.status(200).json({ code: 'SUCCESS', message: 'OK' })
    }
    // 旧版商家转账到零钱批量回调
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

// 查询微信转账单真实状态并同步到本地提现单（只处理本人单据）
async function syncTransferState(id, userId) {
  const [rows] = await pool.query('SELECT * FROM wallet_withdrawal WHERE id = ? AND user_id = ?', [id, userId])
  const withdrawal = rows[0]
  if (!withdrawal) return null
  if (['SUCCESS', 'FAILED', 'REJECTED'].includes(withdrawal.status) || !withdrawal.out_batch_no) return withdrawal
  try {
    const bill = await wechat.queryTransferBill(withdrawal.out_batch_no)
    const state = bill.state || ''
    const stateMap = { SUCCESS: 'SUCCESS', FAIL: 'FAILED', CANCELLED: 'FAILED' }
    const status = stateMap[state] || 'WAIT_CONFIRM'
    await pool.query(
      "UPDATE wallet_withdrawal SET status = ?, transfer_bill_no = COALESCE(?, transfer_bill_no), package_info = COALESCE(?, package_info), completed_at = CASE WHEN ? = 'SUCCESS' THEN NOW() ELSE completed_at END, last_error = ? WHERE id = ?",
      [status, bill.transfer_bill_no || null, bill.package_info || null, status, status === 'FAILED' ? '转账失败或已撤销' : null, id]
    )
    withdrawal.status = status
    withdrawal.package_info = bill.package_info || withdrawal.package_info
  } catch (error) {
    console.error('[wallet-transfer-query]', safeMessage(error))
  }
  return withdrawal
}

// 用户确认收款前获取拉起微信收款页所需的凭证
exports.transferPackage = async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) return fail(res, 'Withdrawal not found', 404)
  try {
    const withdrawal = await syncTransferState(id, req.userId)
    if (!withdrawal) return fail(res, 'Withdrawal not found', 404)
    if (withdrawal.status === 'SUCCESS') return success(res, { status: 'SUCCESS' })
    if (withdrawal.status !== 'WAIT_CONFIRM' || !withdrawal.package_info) return fail(res, '当前提现单无需确认收款', 409)
    success(res, { status: withdrawal.status, appId: payConfig.appId, mchId: payConfig.mchId, packageInfo: withdrawal.package_info })
  } catch (error) { fail(res, safeMessage(error), 500) }
}

// 用户确认收款后同步打款结果
exports.syncTransfer = async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) return fail(res, 'Withdrawal not found', 404)
  try {
    const withdrawal = await syncTransferState(id, req.userId)
    if (!withdrawal) return fail(res, 'Withdrawal not found', 404)
    success(res, { status: withdrawal.status })
  } catch (error) { fail(res, safeMessage(error), 500) }
}
