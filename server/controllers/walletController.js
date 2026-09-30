const pool = require('../config/pool')
const { success, fail } = require('../middleware/auth')
const { safeMessage } = require('../utils/helpers')
const { writeAdminAudit } = require('../utils/adminAudit')
const { createNotification } = require('../services/notificationService')
const subscribeService = require('../services/subscribeService')
const wechat = require('../services/wechatPayV3Service')
const payConfig = require('../config/wechatPay')

function toFen(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

async function totals(conn, userId, lock) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const [[earnings]] = await conn.query(`SELECT IFNULL(SUM(amount_fen), 0) amount FROM wallet_ledger WHERE user_id = ?${suffix}`, [userId])
  // reserved：在途提现（审核/转账/待用户确认收款），仍占用余额
  // withdrawn：已成功到账的提现，属于永久扣减；此前只扣 reserved 导致提现到账后可用余额"回满"，可重复提现（双花）
  const [[reserved]] = await conn.query(`SELECT IFNULL(SUM(amount_fen), 0) amount FROM wallet_withdrawal WHERE user_id = ? AND status IN ('PENDING', 'PROCESSING', 'WAIT_CONFIRM')${suffix}`, [userId])
  const [[withdrawn]] = await conn.query(`SELECT IFNULL(SUM(amount_fen), 0) amount FROM wallet_withdrawal WHERE user_id = ? AND status = 'SUCCESS'${suffix}`, [userId])
  return { earnedFen: Number(earnings.amount), reservedFen: Number(reserved.amount), withdrawnFen: Number(withdrawn.amount) }
}

function walletData(values) {
  return {
    earned: values.earnedFen / 100,
    withdrawing: values.reservedFen / 100,
    // 可提现 = 累计收益 - 在途提现 - 已到账提现（REJECTED/FAILED 单从未扣款，不计入）
    available: Math.max(0, values.earnedFen - values.reservedFen - values.withdrawnFen) / 100
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
    // 锁定用户行，串行化同一用户的并发提现请求：
    // 否则两个并发事务在各自快照里都读到旧余额并同时通过校验（FOR UPDATE 对 ledger/withdrawal 无行可锁时形同虚设）
    await conn.query('SELECT id FROM sys_user WHERE id = ? FOR UPDATE', [req.userId])
    // 每日提现次数上限（与前端 WITHDRAW_RULES.dailyLimit 保持一致；前端校验可被绕过，此处为最终防线）
    const DAILY_WITHDRAW_LIMIT = 5
    const [[daily]] = await conn.query(
      'SELECT COUNT(*) total FROM wallet_withdrawal WHERE user_id = ? AND created_at >= CURDATE()',
      [req.userId]
    )
    if (Number(daily.total) >= DAILY_WITHDRAW_LIMIT) {
      await conn.rollback()
      return fail(res, `今日提现次数已达上限（${DAILY_WITHDRAW_LIMIT}次）`, 429)
    }
    const amount = await totals(conn, req.userId, true)
    if (amountFen > amount.earnedFen - amount.reservedFen - amount.withdrawnFen) {
      await conn.rollback()
      return fail(res, 'Insufficient available balance', 422)
    }
    const token = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase()
    const [result] = await conn.query(
      "INSERT INTO wallet_withdrawal (user_id, amount_fen, out_batch_no, out_detail_no) VALUES (?, ?, ?, ?)",
      [req.userId, amountFen, `WD${token}`.slice(0, 64), `WDD${token}`.slice(0, 64)]
    )
    await conn.commit()
    success(res, { id: result.insertId, status: 'PENDING', available: (amount.earnedFen - amount.reservedFen - amount.withdrawnFen - amountFen) / 100 }, 'Withdrawal submitted')
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
      pool.query(`SELECT w.id, w.user_id userId, u.nick_name nickName, u.avatar_url avatarUrl, u.phone phone, w.amount_fen amountFen, w.status, w.review_note reviewNote, w.last_error lastError, w.created_at createdAt, w.reviewed_at reviewedAt FROM wallet_withdrawal w JOIN sys_user u ON u.id = w.user_id ${where} ORDER BY w.id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, offset]))
    ])
    success(res, { list: list.map((item) => ({ ...item, amount: Number(item.amountFen) / 100 })), total: Number(count[0].total), page, hasMore: offset + list.length < Number(count[0].total) })
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
      // 提现结果订阅提醒（增强能力，不 await 不影响审核响应）
      subscribeService.pushWithdrawResult(withdrawal.user_id, { orderNo: String(id), amountFen: withdrawal.amount_fen, statusText: '已驳回', note: note || '提现申请被驳回，金额已退回余额' })
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
      subscribeService.pushWithdrawSuccess(withdrawal.user_id, { orderNo: String(id), amountFen: withdrawal.amount_fen, note: '提现审核通过，已打款' })
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
      if (status === 'SUCCESS') subscribeService.pushWithdrawSuccess(withdrawal.user_id, { orderNo: String(id), amountFen: withdrawal.amount_fen, note: '提现已到账微信零钱' })
      else subscribeService.pushWithdrawResult(withdrawal.user_id, { orderNo: String(id), amountFen: withdrawal.amount_fen, statusText: '处理中', note: '提现已提交微信处理' })
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
    if (status === 'SUCCESS') subscribeService.pushWithdrawSuccess(withdrawal.user_id, { orderNo: String(id), amountFen: withdrawal.amount_fen, note: '提现已到账微信零钱' })
    else if (status === 'WAIT_CONFIRM') subscribeService.pushWithdrawResult(withdrawal.user_id, { orderNo: String(id), amountFen: withdrawal.amount_fen, statusText: '待确认', note: '请点击「确认收款」完成提现' })
    success(res, { status })
  } catch (error) {
    // 转账失败时用户的可用余额不变（单据回到 PENDING 继续占用冻结额度），
    // 把微信的真实原因翻译成中文写进 last_error，管理员可在列表直接看到并原单号重试。
    const described = wechat.describeTransferError(error)
    console.error('[wallet-withdraw-transfer]', described.code, safeMessage(error))
    const stored = `${described.message}｜${described.hint}`.slice(0, 500)
    await pool.query("UPDATE wallet_withdrawal SET status = 'PENDING', last_error = ? WHERE id = ? AND status = 'PROCESSING'", [stored, id]).catch(() => {})
    // 422 而不是 502：请求本身合法，是商户侧资金/配置问题导致无法执行，
    // 502 会被前端当成"网关挂了"并触发重试，掩盖真实原因
    fail(res, described.message, 422, { code: described.code, hint: described.hint })
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
        if (withdrawal) {
          await createNotification({ userId: withdrawal.user_id, type: 'system', title: 'Withdrawal paid', content: 'Your withdrawal has been sent to your WeChat wallet.', relatedId: resource.out_bill_no })
          subscribeService.pushWithdrawSuccess(withdrawal.user_id, { orderNo: String(resource.out_bill_no), amountFen: withdrawal.amount_fen, note: '提现已到账微信零钱' })
        }
      }
      return res.status(200).json({ code: 'SUCCESS', message: 'OK' })
    }
    // 旧版商家转账到零钱批量回调
    const remoteStatus = resource.batch_status || resource.status || 'PROCESSING'
    const status = remoteStatus === 'FINISHED' ? 'SUCCESS' : remoteStatus === 'CLOSED' ? 'FAILED' : 'PROCESSING'
    const [result] = await pool.query("UPDATE wallet_withdrawal SET status = ?, wx_batch_id = COALESCE(?, wx_batch_id), completed_at = CASE WHEN ? = 'SUCCESS' THEN NOW() ELSE completed_at END WHERE out_batch_no = ?", [status, resource.batch_id || null, status, resource.out_batch_no])
    if (result.affectedRows) {
      const [[withdrawal]] = await pool.query('SELECT user_id FROM wallet_withdrawal WHERE out_batch_no = ?', [resource.out_batch_no])
      if (withdrawal && status === 'SUCCESS') {
        await createNotification({ userId: withdrawal.user_id, type: 'system', title: 'Withdrawal paid', content: 'Your withdrawal has been sent to your WeChat wallet.', relatedId: resource.out_batch_no })
        subscribeService.pushWithdrawSuccess(withdrawal.user_id, { orderNo: String(resource.out_batch_no), amountFen: withdrawal.amount_fen, note: '提现已到账微信零钱' })
      }
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
