const express = require('express')
const router = express.Router()
const commentController = require('../controllers/commentController')
const { auth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.get('/list', commentController.list)
router.get('/top-liked', commentController.topLiked)
router.post('/', auth, contentSecurity, commentController.create)
router.put('/:id', auth, contentSecurity, commentController.update)
router.delete('/:id', auth, commentController.remove)
router.post('/:id/like', auth, commentController.like)

module.exports = router
