const express = require('express')
const router = express.Router()
const controller = require('../controllers/feedbackController')
const { auth, requireAdmin } = require('../middleware/auth')
const contentSecurity = require('../middleware/contentSecurity')

router.get('/', controller.listPublic)
router.post('/', auth, contentSecurity, controller.create)
router.post('/:id/reply', auth, requireAdmin('content.manage'), contentSecurity, controller.reply)
router.put('/:id/reply', auth, requireAdmin('content.manage'), contentSecurity, controller.updateReply)
router.delete('/:id/reply', auth, requireAdmin('content.manage'), controller.removeReply)
// 意见墙用户评论：所有人可评论/回复，作者本人或管理员可删
router.post('/:id/comments', auth, contentSecurity, controller.addComment)
router.delete('/comments/:commentId', auth, controller.deleteComment)
// 管理员标记意见状态（已解决/取消解决）
router.put('/:id/status', auth, requireAdmin('content.manage'), controller.setStatus)
router.put('/:id', auth, contentSecurity, controller.update)
router.delete('/:id', auth, controller.remove)
router.post('/report', auth, contentSecurity, controller.report)

module.exports = router
