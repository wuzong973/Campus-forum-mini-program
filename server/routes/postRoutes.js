const express = require('express')
const router = express.Router()
const postController = require('../controllers/postController')
const { auth, optionalAuth, requireAdmin } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.get('/list', optionalAuth, postController.list)
router.get('/search', optionalAuth, postController.search)
router.get('/hot', optionalAuth, postController.hot)
router.get('/hot-rank', optionalAuth, postController.hotRank)
router.get('/:id', optionalAuth, postController.detail)
router.post('/', auth, contentSecurity, postController.create)
router.delete('/:id', auth, postController.remove)
router.post('/:id/not-interested', auth, postController.hideAsNotInterested)
router.post('/:id/review-note', auth, requireAdmin('content.manage'), postController.updateReviewNote)
router.post('/:id/like', auth, postController.like)
router.post('/:id/favorite', auth, postController.favorite)

module.exports = router
