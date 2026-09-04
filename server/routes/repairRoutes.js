const express = require('express')
const controller = require('../controllers/repairController')
const paymentController = require('../controllers/paymentController')
const { auth } = require('../middleware/auth')
const idempotency = require('../middleware/idempotency')

const router = express.Router()
router.get('/technicians', auth, controller.listTechnicians)
router.get('/orders', auth, controller.listMine)
router.post('/orders', auth, controller.create)
router.post('/orders/:id/pay', auth, idempotency, paymentController.createRepairPayment)
router.get('/orders/:id/payment-status', auth, paymentController.queryRepairPaymentStatus)
// Keep this endpoint while merchant configuration migrates to /payment/notify.
router.post('/payment/notify', paymentController.paymentNotify)

module.exports = router
