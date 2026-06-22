const express = require('express')
const router = express.Router()
const userController = require('../controllers/userController')
const uploadController = require('../controllers/uploadController')
const { auth } = require('../middleware/auth')

router.post('/phone-login', userController.phoneLogin)
router.post('/content-check', auth, userController.contentCheck)
router.get('/info', auth, userController.getInfo)
router.put('/info', auth, userController.updateInfo)
router.post('/verify', auth, userController.verify)
router.post('/upload/image', auth, uploadController.uploadMiddleware, uploadController.uploadImage)

module.exports = router
