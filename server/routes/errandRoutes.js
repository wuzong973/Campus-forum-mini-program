const express = require('express')
const router = express.Router()
const errandController = require('../controllers/errandController')
const paymentController = require('../controllers/paymentController')
const { auth, optionalAuth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')
const { messageTextSecurity } = require('../middleware/contentSecurity')
const idempotency = require('../middleware/idempotency')

router.get('/list', optionalAuth, errandController.list)
router.get('/my-published', auth, errandController.myPublished)
router.get('/my-accepted', auth, errandController.myAccepted)
// 跑腿订单专属聊天（与私信独立）：/chats 为固定路径，必须注册在 /:id 之前
router.get('/chats', auth, errandController.chats)
router.post('/chats/:id/read', auth, errandController.markChatRead)
router.get('/:id/messages', auth, errandController.chatMessages)
// P09：与私信同一口径 —— 文本消息走内容安全检测，图片/视频消息按类型跳过（content 是媒体 URL）
router.post('/:id/messages', auth, messageTextSecurity, errandController.sendChatMessage)
router.post('/cancel-requests/:id/review', auth, errandController.reviewCancelRequest)
router.get('/:id/payment-status', auth, paymentController.queryErrandPaymentStatus)
router.get('/:id', auth, errandController.detail)
router.get('/:id/logs', auth, errandController.logs)
router.post('/', auth, contentSecurity, idempotency, errandController.create)
router.post('/:id/pay', auth, idempotency, paymentController.createErrandPayment)
router.post('/:id/accept', auth, errandController.accept)
router.post('/:id/release', auth, idempotency, errandController.release)
// 接单方提交完成 → 订单转「待确认」；发单人确认完成 → 正式完成并结算；发单人提出异议 → 转「有异议」等后台裁决
router.post('/:id/finish', auth, errandController.finish)
router.post('/:id/confirm', auth, errandController.confirm)
router.post('/:id/dispute', auth, contentSecurity, errandController.dispute)
router.post('/:id/cancel', auth, idempotency, paymentController.cancelErrand)
router.post('/:id/review', auth, contentSecurity, errandController.review)

module.exports = router
