const express = require('express')
const router = express.Router()
const messageController = require('../controllers/messageController')
const { auth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.post('/send', auth, contentSecurity, messageController.send)
router.get('/history', auth, messageController.history)
router.get('/conversations', auth, messageController.conversations)
router.put('/read', auth, messageController.markRead)
router.get('/unread-count', auth, messageController.unreadCount)
router.put('/status', auth, messageController.updateStatus)

module.exports = router
