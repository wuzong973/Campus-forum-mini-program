const express = require('express')
const router = express.Router()
const scheduleController = require('../controllers/scheduleController')
const idempotency = require('../middleware/idempotency')
const uploadController = require('../controllers/uploadController')
const ocrService = require('../services/ocrService')
const { auth } = require('../middleware/auth')

router.get('/list', auth, scheduleController.list)
router.post('/add', auth, scheduleController.add)
router.post('/replace', auth, idempotency, scheduleController.replace)
router.post('/clear', auth, scheduleController.clear)
router.put('/course/:id', auth, scheduleController.updateCourse)
router.delete('/course/:id', auth, scheduleController.deleteCourse)
// captureOcrImageMiddleware 必须在内容安全检测前执行：生产环境检测会把长图压到 1080px，
// OCR 需要在此之前留下高清副本
router.post('/ocr', auth, uploadController.uploadScheduleImageMiddleware, ocrService.captureOcrImageMiddleware, uploadController.imageSecurityMiddleware, scheduleController.ocr)
router.post('/sync', auth, scheduleController.sync)
router.post('/sync/captcha', auth, scheduleController.syncCaptcha)
router.post('/sync/captcha/refresh', auth, scheduleController.refreshCaptcha)
router.post('/refresh', auth, scheduleController.refresh)
router.get('/bind', auth, scheduleController.bindStatus)
router.get('/exams', auth, scheduleController.listExams)
router.get('/grades', auth, scheduleController.listGrades)
router.get('/config', auth, scheduleController.getConfig)
router.put('/config', auth, idempotency, scheduleController.updateConfig)

module.exports = router
