const express = require('express')
const router = express.Router()
const reviewController = require('../controllers/reviewController')
const { auth, optionalAuth } = require('../middleware/auth')

// 公开：评分对象列表 / 详情 / 随机抽取（登录用户附带我的评分与点赞状态）
router.get('/targets', optionalAuth, reviewController.targets)
router.get('/target/:id', optionalAuth, reviewController.detail)
router.get('/random', reviewController.random)
// 评价列表公开可读，登录用户附带点赞状态
router.get('/target/:id/comments', optionalAuth, reviewController.comments)

// 需登录：发布评分对象 / 评分 / 点赞 / 评价
router.post('/target', auth, reviewController.createTarget)
router.post('/target/:id/rate', auth, reviewController.rate)
router.post('/target/:id/like', auth, reviewController.likeTarget)
router.post('/target/:id/comments', auth, reviewController.addComment)
router.post('/comment/:id/like', auth, reviewController.likeComment)

module.exports = router
