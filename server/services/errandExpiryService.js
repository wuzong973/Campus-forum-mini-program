// 跑腿订单超时自动取消服务：
// 1. 待支付订单（未成功支付）超过 30 分钟 → 自动取消（无需退款）；
// 2. 超过发布时设置的「截止接单时间」仍未接单 → 自动取消，已支付的赏金原路退回发布者支付账户。
// 注意：不再有「待接单超过 30 分钟自动取消」的规则，待接单订单只要未过截止时间就一直有效
//（发布时未设置截止时间的订单同样长期有效）。
// 由 app.js 启动时调用 start()，每分钟巡检一次；全部操作幂等，可安全重复执行。
const pool = require('../config/pool')
const paymentController = require('../controllers/paymentController')
const wechat = require('./wechatPayV3Service')
const { safeMessage } = require('../utils/helpers')
const { createNotification } = require('./notificationService')

const EXPIRE_MINUTES = 30
const INTERVAL_MS = 60 * 1000
const UNPAID_STATES = "('UNPAID', 'PREPAY', 'CREATED')"
// 接单方提交完成后，发单人确认时限（小时）。逾期未确认且未提出异议 → 系统自动确认完成并结算
const AUTO_CONFIRM_HOURS = 2

let timer = null
let running = false

async function logOrder(conn, orderId, action, detail) {
  await conn.query(
    'INSERT INTO errand_order_log (order_id, actor_id, action, detail) VALUES (?, NULL, ?, ?)',
    [orderId, String(action), String(detail || '').slice(0, 255)]
  )
}

async function notifyPublisher(userId, title, content, orderId, event) {
  if (!userId) return
  try {
    await createNotification({ userId, type: 'errand', title, content, relatedId: orderId })
  } catch (e) {
    console.error('[ErrandExpiry][notify]', safeMessage(e))
  }
  // 系统自动流转（超时取消/自动确认等）此前只发站内信；补上微信订阅提醒，与用户操作路径口径一致。
  // event 显式声明订单事件类型（accepted/finished/cancelled/none），避免靠中文关键词猜模板。
  try {
    // 惰性 require 避免加载顺序问题（errandController 不依赖本服务，无循环）
    require('../controllers/errandController').pushErrandSubscribe(userId, orderId, title, content, event)
  } catch (e) {
    console.error('[ErrandExpiry][subscribe]', safeMessage(e))
  }
}

// 一、待支付超时：status 仍为 pending 且支付未成功 → 取消订单，关闭未完成的预支付单。
// 若用户恰好在取消后才完成支付（回调迟到），paymentController.settlePayment 会检测到
// 订单已 cancelled 并自动原路退款（refundCancelledErrand），不会造成资损。
async function expireUnpaidOrders() {
  const [rows] = await pool.query(
    `SELECT e.id, e.publisher_id, e.title FROM errand_order e
     WHERE e.status = 'pending'
       AND (e.payment_status IS NULL OR e.payment_status IN ${UNPAID_STATES})
       AND e.created_at < NOW() - INTERVAL ? MINUTE
     LIMIT 50`,
    [EXPIRE_MINUTES]
  )
  for (const order of rows) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      // 带条件更新保证幂等与并发安全：只有仍处于待支付状态时才取消
      const [result] = await conn.query(
        `UPDATE errand_order SET status = 'cancelled'
         WHERE id = ? AND status = 'pending'
           AND (payment_status IS NULL OR payment_status IN ${UNPAID_STATES})`,
        [order.id]
      )
      if (!result.affectedRows) { await conn.rollback(); continue }
      // 关闭本地未完成的支付流水（若用户实际已付款，微信回调仍会正常结算并自动退款）
      await conn.query(
        `UPDATE payment_transaction SET status = 'CLOSED', last_error = '超时未支付，系统自动取消订单'
         WHERE business_type = 'errand' AND business_order_id = ? AND status IN ('CREATED', 'PREPAY')`,
        [order.id]
      )
      await logOrder(conn, order.id, 'timeout_cancelled', `超过${EXPIRE_MINUTES}分钟未支付，系统自动取消订单`)
      await conn.commit()
      await notifyPublisher(order.publisher_id, '订单已自动取消', `“${order.title}”超过${EXPIRE_MINUTES}分钟未支付，系统已自动取消`, order.id, 'cancelled')
      console.log(`[ErrandExpiry] 待支付订单 #${order.id} 超时自动取消`)
    } catch (e) {
      await conn.rollback().catch(() => {})
      console.error(`[ErrandExpiry] 取消待支付订单 #${order.id} 失败:`, safeMessage(e))
    } finally {
      conn.release()
    }
  }
}

// 二、截止接单超时：发布时设置了「截止接单时间」，到期仍无人接单 → 取消订单；
// 已支付的赏金原路退回，未支付的直接取消（无款可退）。
// （原「待接单超过30分钟自动取消」规则已移除：待接单订单只要未过截止时间即持续有效。）
async function expireDeadlineOrders() {
  const [rows] = await pool.query(
    `SELECT e.id, e.publisher_id, e.title, e.payment_status FROM errand_order e
     WHERE e.status = 'pending' AND e.accept_deadline IS NOT NULL AND e.accept_deadline < NOW()
     LIMIT 50`
  )
  for (const order of rows) {
    const paid = order.payment_status === 'SUCCESS'
    const conn = await pool.getConnection()
    let cancelled = false
    try {
      await conn.beginTransaction()
      // 带条件更新保证幂等与并发安全：仅当仍为待接单且已过截止时间时取消
      const [result] = await conn.query(
        `UPDATE errand_order SET status = 'cancelled'
         WHERE id = ? AND status = 'pending' AND accept_deadline IS NOT NULL AND accept_deadline < NOW()`,
        [order.id]
      )
      cancelled = result.affectedRows > 0
      if (cancelled) {
        if (!paid) {
          await conn.query(
            `UPDATE payment_transaction SET status = 'CLOSED', last_error = '超过截止接单时间，系统自动取消订单'
             WHERE business_type = 'errand' AND business_order_id = ? AND status IN ('CREATED', 'PREPAY')`,
            [order.id]
          )
        }
        await logOrder(conn, order.id, 'deadline_cancelled', `超过截止接单时间，系统自动取消${paid ? '，赏金原路退回' : ''}`)
      }
      await conn.commit()
    } catch (e) {
      await conn.rollback().catch(() => {})
      console.error(`[ErrandExpiry] 截止接单取消订单 #${order.id} 失败:`, safeMessage(e))
    } finally {
      conn.release()
    }
    if (!cancelled) continue
    if (paid) {
      // 复用既有退款链路：原路退回发布者微信支付账户（幂等，可重试）
      try {
        const result = await paymentController.cancelErrandAndRefund(order.id)
        const refundStatus = (result && result.refund && result.refund.status) || null
        console.log(`[ErrandExpiry] 订单 #${order.id} 超过截止接单时间自动取消，退款状态: ${refundStatus || '无需退款'}`)
      } catch (e) {
        console.error(`[ErrandExpiry] 订单 #${order.id} 退款发起失败（订单已取消，待人工/对账重试）:`, safeMessage(e))
      }
      await notifyPublisher(
        order.publisher_id,
        '订单超过截止接单时间已取消',
        `“${order.title}”超过截止接单时间仍无人接单，已自动取消，赏金将原路退回你的支付账户`,
        order.id,
        'cancelled'
      )
    } else {
      await notifyPublisher(
        order.publisher_id,
        '订单超过截止接单时间已取消',
        `“${order.title}”超过截止接单时间仍无人接单（未支付），已自动取消`,
        order.id,
        'cancelled'
      )
      console.log(`[ErrandExpiry] 订单 #${order.id} 超过截止接单时间自动取消（未支付）`)
    }
  }
}

// 三、待确认超时自动完成：接单方提交完成后（status = finishing），发单人超过 AUTO_CONFIRM_HOURS
// 小时既未确认完成也未提出异议 → 系统判定订单自动确认完成，赏金自动转入接单方钱包。
// 提出异议的订单为 disputed，不在扫描范围内，必须由管理后台裁决。
// 幂等：带 status = 'finishing' 条件更新，钱包流水有唯一键，重复巡检不会重复入账。
async function autoConfirmFinishingOrders() {
  const [rows] = await pool.query(
    `SELECT e.id, e.publisher_id, e.acceptor_id, e.title, e.reward, e.payment_status
     FROM errand_order e
     WHERE e.status = 'finishing' AND e.finish_submitted_at IS NOT NULL
       AND e.finish_submitted_at < NOW() - INTERVAL ? HOUR
     LIMIT 50`,
    [AUTO_CONFIRM_HOURS]
  )
  for (const order of rows) {
    const conn = await pool.getConnection()
    let confirmed = false
    try {
      await conn.beginTransaction()
      const [result] = await conn.query(
        `UPDATE errand_order SET status = 'finished', finished_at = NOW(), confirmed_at = NOW(), auto_confirmed = 1
         WHERE id = ? AND status = 'finishing'`,
        [order.id]
      )
      confirmed = result.affectedRows > 0
      if (confirmed) {
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
        await logOrder(conn, order.id, 'auto_confirmed', `发单人超过${AUTO_CONFIRM_HOURS}小时未确认，系统自动确认完成，赏金转入接单方钱包`)
      }
      await conn.commit()
    } catch (e) {
      await conn.rollback().catch(() => {})
      console.error(`[ErrandExpiry] 自动确认完成订单 #${order.id} 失败:`, safeMessage(e))
    } finally {
      conn.release()
    }
    if (!confirmed) continue
    await notifyPublisher(
      order.publisher_id,
      '订单已自动确认完成',
      `“${order.title}”提交完成已超过${AUTO_CONFIRM_HOURS}小时，系统已自动确认完成，赏金已转入接单方钱包`,
      order.id,
      'finished'
    )
    await notifyPublisher(
      order.acceptor_id,
      '订单已自动确认完成',
      `“${order.title}”发单人超时未确认，系统已自动确认完成，赏金已转入你的钱包`,
      order.id,
      'finished'
    )
    console.log(`[ErrandExpiry] 订单 #${order.id} 提交完成超时，已自动确认完成并结算`)
  }
}

// 四、退款失败自动重试：订单已取消且支付成功（或退款中），但当前没有进行中的退款单
//（上次尝试已 FAILED 或从未发起）→ 重新走 reserveErrandRefund + submitErrandRefund。
// 幂等：reserveErrandRefund 对已取消订单只补发退款；限流：同一订单 10 分钟内最多重试一次。
async function retryPendingRefunds() {
  // MAX_REFUND_ATTEMPTS：同一笔支付最多自动重试次数（payment_refund 每次尝试都会落一行）。
  // 超过上限后停止自动重试，避免对永久失败的退款每 10 分钟无限发起（堆积脏数据/骚扰微信接口）；
  // 在途 CREATED/PROCESSING 的退款仍由 reconcileStuckRefunds 正常对账。
  const MAX_REFUND_ATTEMPTS = 5
  const [rows] = await pool.query(
    `SELECT e.id, e.publisher_id, e.title FROM errand_order e
     JOIN payment_transaction p ON p.business_type = 'errand' AND p.business_order_id = e.id
     WHERE e.status = 'cancelled'
       AND e.payment_status IN ('SUCCESS', 'REFUNDING')
       AND p.status IN ('SUCCESS', 'REFUNDING')
       AND NOT EXISTS (
         SELECT 1 FROM payment_refund r
         WHERE r.payment_id = p.id
           AND (r.status IN ('CREATED', 'PROCESSING', 'SUCCESS') OR r.created_at > NOW() - INTERVAL 10 MINUTE)
       )
       AND (SELECT COUNT(*) FROM payment_refund r2 WHERE r2.payment_id = p.id) < ?
     LIMIT 10`,
    [MAX_REFUND_ATTEMPTS]
  )
  for (const order of rows) {
    try {
      const result = await paymentController.cancelErrandAndRefund(order.id)
      const refundStatus = (result && result.refund && result.refund.status) || null
      await notifyPublisher(
        order.publisher_id,
        '退款已重新发起',
        `“${order.title}”的退款此前未能完成，系统已重新发起，赏金将原路退回你的支付账户`,
        order.id,
        'none'
      )
      console.log(`[ErrandExpiry] 订单 #${order.id} 退款重试已发起，状态: ${refundStatus || '未知'}`)
    } catch (e) {
      console.error(`[ErrandExpiry] 订单 #${order.id} 退款重试失败:`, safeMessage(e))
    }
  }
}

// 五、退款对账兜底：退款单长时间停留在 CREATED/PROCESSING（微信侧可能已退款成功但结果回调丢失/
// 打到不存在的地址）→ 主动查询微信退款真实状态并同步本地，避免订单永远显示「退款中」。
// SUCCESS → updateRefundState 自动把订单刷成 REFUNDED；ABNORMAL/CLOSED/查无此单 → 置 FAILED
// 回滚 REFUNDING，交由 retryPendingRefunds 重新发起。回调正常时本任务无事可做。
const RECONCILE_AFTER_MINUTES = 10
async function reconcileStuckRefunds() {
  const [rows] = await pool.query(
    `SELECT r.id, r.out_refund_no, r.payment_id FROM payment_refund r
     JOIN payment_transaction p ON p.id = r.payment_id
     WHERE r.status IN ('CREATED', 'PROCESSING')
       AND r.created_at < NOW() - INTERVAL ? MINUTE
     LIMIT 20`,
    [RECONCILE_AFTER_MINUTES]
  )
  for (const refund of rows) {
    try {
      const remote = await wechat.queryRefund(refund.out_refund_no)
      const state = String(remote.status || '').toUpperCase()
      if (['SUCCESS', 'PROCESSING', 'CREATED'].includes(state)) {
        if (state !== 'PROCESSING' || refund.status !== 'PROCESSING') {
          await paymentController.updateRefundState(refund.id, state, remote.refund_id)
          if (state === 'SUCCESS') console.log(`[ErrandExpiry] 退款单 #${refund.id} 对账确认成功，订单状态已同步`)
        }
      } else if (['ABNORMAL', 'CLOSED'].includes(state)) {
        await pool.query("UPDATE payment_refund SET status = 'FAILED', last_error = ? WHERE id = ?", [`微信侧退款状态异常: ${state}`, refund.id])
        await pool.query("UPDATE payment_transaction SET status = 'SUCCESS' WHERE id = ? AND status = 'REFUNDING'", [refund.payment_id])
        await pool.query("UPDATE errand_order e JOIN payment_transaction p ON p.business_type = 'errand' AND p.business_order_id = e.id SET e.payment_status = 'SUCCESS' WHERE p.id = ? AND e.payment_status = 'REFUNDING'", [refund.payment_id])
        console.log(`[ErrandExpiry] 退款单 #${refund.id} 对账发现微信侧 ${state}，已置为失败待重试`)
      }
    } catch (e) {
      // 微信查无此退款单（如发起请求实际未到达微信）→ 置 FAILED 交由重试任务补发
      if (e && (e.wxStatus === 404 || e.wxCode === 'RESOURCE_NOT_EXISTS' || e.wxCode === 'NOT_FOUND')) {
        await pool.query("UPDATE payment_refund SET status = 'FAILED', last_error = '对账查询微信侧无此退款单' WHERE id = ?", [refund.id]).catch(() => {})
        await pool.query("UPDATE payment_transaction SET status = 'SUCCESS' WHERE id = ? AND status = 'REFUNDING'", [refund.payment_id]).catch(() => {})
        await pool.query("UPDATE errand_order eo JOIN payment_transaction p ON p.business_type = 'errand' AND p.business_order_id = eo.id SET eo.payment_status = 'SUCCESS' WHERE p.id = ? AND eo.payment_status = 'REFUNDING'", [refund.payment_id]).catch(() => {})
        console.log(`[ErrandExpiry] 退款单 #${refund.id} 微信侧不存在，已置为失败待重试`)
      } else {
        console.error(`[ErrandExpiry] 退款单 #${refund.id} 对账查询失败:`, safeMessage(e))
      }
    }
  }
}

async function runOnce() {
  if (running) return
  running = true
  try {
    await expireUnpaidOrders()
    await expireDeadlineOrders()
    await autoConfirmFinishingOrders()
    await retryPendingRefunds()
    await reconcileStuckRefunds()
  } catch (e) {
    console.error('[ErrandExpiry]', safeMessage(e))
  } finally {
    running = false
  }
}

function start() {
  if (timer) return
  // 启动 15 秒后先跑一次，之后每分钟巡检
  timer = setInterval(runOnce, INTERVAL_MS)
  setTimeout(() => { runOnce() }, 15 * 1000)
  console.log(`[ErrandExpiry] 订单超时任务已启动（每分钟巡检：待支付超30分钟取消 / 超过截止接单时间取消并退款 / 待确认超${AUTO_CONFIRM_HOURS}小时自动完成 / 退款对账兜底）`)
}

module.exports = { start, runOnce }
