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
// 编辑评价评论（仅作者本人）：与论坛评论同款，只有作者能改自己的内容。
router.post('/comment/:id/update', auth, reviewController.updateComment)
// 删除评价评论（软删 deleted = 1）：管理员（content.manage）可删任意；评论作者可删自己的。
// 与论坛评论的「删除他人的评论」不同：评分对象是公共条目、没有「作者」，
// 因此不引入「评分对象创建者可删他人评论」这一档，避免权限口径比论坛更宽。
router.post('/comment/:id/delete', auth, reviewController.deleteComment)

module.exports = router
