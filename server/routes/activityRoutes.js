const express = require('express')
const router = express.Router()
const activityController = require('../controllers/activityController')
const { auth, optionalAuth } = require('../middleware/auth')

// 公开：活动列表 / 详情（登录用户附带报名状态）
router.get('/list', optionalAuth, activityController.list)
router.get('/detail/:id', optionalAuth, activityController.detail)
// 需登录：发布活动 / 报名
router.post('/create', auth, activityController.create)
router.post('/signup/:id', auth, activityController.signup)

module.exports = router
