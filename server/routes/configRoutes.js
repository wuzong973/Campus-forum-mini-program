const express = require('express')
const router = express.Router()
const controller = require('../controllers/configController')
const { auth, optionalAuth, requireAdmin } = require('../middleware/auth')

router.get('/home', controller.home)

// 消息通知横幅：公开读取（管理员额外可读已下线草稿）；保存需管理员权限
router.get('/message-banner', optionalAuth, controller.messageBanner)
router.put('/message-banner', auth, requireAdmin('config.manage'), controller.saveMessageBanner)

// 帖子详情页「每日热榜」上方横幅：机制同上，内容独立
router.get('/post-banner', optionalAuth, controller.postBanner)
router.put('/post-banner', auth, requireAdmin('config.manage'), controller.savePostBanner)

module.exports = router
