const express = require('express')
const router = express.Router()
const notificationController = require('../controllers/notificationController')
const { auth } = require('../middleware/auth')

router.get('/', auth, notificationController.list)
router.put('/read-all', auth, notificationController.markAllRead)
router.put('/:id/read', auth, notificationController.markRead)

module.exports = router
