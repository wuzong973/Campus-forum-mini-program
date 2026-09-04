const express = require('express')
const router = express.Router()
const controller = require('../controllers/walletController')
const { auth } = require('../middleware/auth')
const idempotency = require('../middleware/idempotency')

router.post('/transfer/notify', controller.transferNotify)
router.use(auth)
router.get('/summary', controller.summary)
router.post('/withdrawals', idempotency, controller.requestWithdrawal)

module.exports = router
