const express = require('express')
const router = express.Router()
const scheduleController = require('../controllers/scheduleController')
const { auth } = require('../middleware/auth')

router.get('/list', auth, scheduleController.list)
router.post('/add', auth, scheduleController.add)
router.post('/ocr', auth, scheduleController.ocr)
router.get('/config', auth, scheduleController.getConfig)
router.put('/config', auth, scheduleController.updateConfig)

module.exports = router
