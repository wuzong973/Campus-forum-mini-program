const express = require('express')
const router = express.Router()
const postController = require('../controllers/postController')
const { auth, optionalAuth } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.get('/list', optionalAuth, postController.list)
router.get('/hot', postController.hot)
router.get('/:id', optionalAuth, postController.detail)
router.post('/', auth, contentSecurity, postController.create)
router.delete('/:id', auth, postController.remove)
router.post('/:id/like', auth, postController.like)
router.post('/:id/favorite', auth, postController.favorite)

module.exports = router
