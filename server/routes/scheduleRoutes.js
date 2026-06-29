const express = require('express')
const router = express.Router()
const scheduleController = require('../controllers/scheduleController')
const uploadController = require('../controllers/uploadController')
const { auth } = require('../middleware/auth')

router.get('/list', auth, scheduleController.list)
router.post('/add', auth, scheduleController.add)
router.post('/clear', auth, scheduleController.clear)
router.post('/ocr', auth, uploadController.uploadScheduleImageMiddleware, scheduleController.ocr)
router.post('/sync', auth, scheduleController.sync)
router.get('/config', auth, scheduleController.getConfig)
router.put('/config', auth, scheduleController.updateConfig)

module.exports = router
