const express = require('express')
const controller = require('../controllers/paymentController')
const { auth, requireAdmin } = require('../middleware/auth')

const router = express.Router()
router.post('/notify', controller.paymentNotify)
router.post('/refund/notify', controller.refundNotify)
router.use(auth)
router.get('/transactions', requireAdmin('payment.manage'), controller.listPayments)
router.post('/transactions/:id/refunds', requireAdmin('payment.manage'), controller.createRefund)
router.get('/refunds/:refundId', requireAdmin('payment.manage'), controller.queryRefund)
module.exports = router
