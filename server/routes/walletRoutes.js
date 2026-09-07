const express = require('express')
const router = express.Router()
const controller = require('../controllers/walletController')
const { auth } = require('../middleware/auth')
const idempotency = require('../middleware/idempotency')

router.post('/transfer/notify', controller.transferNotify)
router.use(auth)
router.get('/summary', controller.summary)
router.post('/withdrawals', idempotency, controller.requestWithdrawal)
// 新版商家转账（用户确认收款）：获取拉起收款页凭证 / 确认后同步打款结果
router.get('/withdrawals/:id/transfer-package', controller.transferPackage)
router.post('/withdrawals/:id/sync-transfer', controller.syncTransfer)

module.exports = router
