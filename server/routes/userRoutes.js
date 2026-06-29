const express = require('express')
const router = express.Router()
const userController = require('../controllers/userController')
const uploadController = require('../controllers/uploadController')
const { auth } = require('../middleware/auth')

router.post('/phone-login', userController.phoneLogin)
router.post('/content-check', auth, userController.contentCheck)
router.get('/info', auth, userController.getInfo)
router.get('/profile/:id', userController.getProfile)
router.get('/profile/:id/posts', userController.getProfilePosts)
router.put('/info', auth, userController.updateInfo)
router.post('/verify', auth, userController.verify)
router.post('/follow/:id', auth, userController.follow)
router.delete('/follow/:id', auth, userController.unfollow)
router.post('/upload/image', auth, uploadController.uploadMiddleware, uploadController.uploadImage)

module.exports = router
