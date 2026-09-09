const express = require('express')
const router = express.Router()
const groupChatController = require('../controllers/groupChatController')
const { auth } = require('../middleware/auth')

// 公开接口：已上架群聊列表 / 群聊详情
router.get('/list', groupChatController.listGroups)
router.get('/detail/:id', groupChatController.detail)
// 需登录：提交建群申请 / 我的申请
router.post('/apply', auth, groupChatController.submitApply)
router.get('/mine', auth, groupChatController.myApplies)

module.exports = router
