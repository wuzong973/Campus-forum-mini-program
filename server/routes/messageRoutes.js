const express = require('express')
const router = express.Router()
const messageController = require('../controllers/messageController')
const { auth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.post('/send', auth, contentSecurity, messageController.send)
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
