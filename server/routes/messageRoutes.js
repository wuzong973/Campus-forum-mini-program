const express = require('express')
const router = express.Router()
const messageController = require('../controllers/messageController')
const { auth } = require('../middleware/auth')
const { messageTextSecurity } = require('../middleware/contentSecurity')

// P09：文本消息过内容安全检测，图片/视频消息按类型跳过（媒体在上传时已检）
router.post('/send', auth, messageTextSecurity, messageController.send)
router.post('/:id/recall', auth, messageController.recall)
router.get('/history', auth, messageController.history)
router.get('/conversations', auth, messageController.conversations)
router.put('/read', auth, messageController.markRead)
router.get('/unread-count', auth, messageController.unreadCount)
router.put('/status', auth, messageController.updateStatus)
router.post('/block', auth, messageController.block)
router.post('/unblock', auth, messageController.unblock)
router.get('/blacklist', auth, messageController.blacklist)

module.exports = router
