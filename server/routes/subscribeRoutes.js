const express = require('express')
const router = express.Router()
const controller = require('../controllers/subscribeController')
const { auth } = require('../middleware/auth')

// 上报订阅授权（用户点了「允许」后调用）
router.post('/report', auth, controller.report)
// 上报「命中弹窗节流」（本地节流层拦下时调用，仅写日志）
router.post('/throttled', auth, controller.throttled)
// 查询剩余额度
router.get('/quota', auth, controller.quota)

module.exports = router
