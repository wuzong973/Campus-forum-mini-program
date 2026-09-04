const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
const pool = require('../config/pool')
const wechat = require('../services/wechatPayV3Service')
const { settlePayment } = require('../controllers/paymentController')

async function main() {
  const minutes = Math.max(5, Number(process.env.PAYMENT_RECONCILE_MINUTES) || 30)
  const [rows] = await pool.query(
    "SELECT merchant_order_no, id FROM payment_transaction WHERE status IN ('CREATED', 'PREPAY') AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE) ORDER BY id LIMIT 200",
    [minutes],
  )
  let settled = 0; let closed = 0; let errors = 0
  for (const payment of rows) {
    try {
      const remote = await wechat.queryTransaction(payment.merchant_order_no)
      if (remote.trade_state === 'SUCCESS') { await settlePayment(remote, 'reconcile'); settled += 1 }
      else if (remote.trade_state === 'CLOSED') { await pool.query("UPDATE payment_transaction SET status = 'CLOSED' WHERE id = ? AND status <> 'SUCCESS'", [payment.id]); closed += 1 }
    } catch (error) { errors += 1; console.error('[payment-reconcile]', payment.merchant_order_no, error.message) }
  }
  console.log(JSON.stringify({ checked: rows.length, settled, closed, errors }))
  await pool.end()
  if (errors) process.exitCode = 1
}

main().catch(async (error) => { console.error('[payment-reconcile-fatal]', error.message); await pool.end(); process.exit(1) })
