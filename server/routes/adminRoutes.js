const express = require('express')
const router = express.Router()
const controller = require('../controllers/adminController')
const walletController = require('../controllers/walletController')
const clubController = require('../controllers/clubController')
const groupChatController = require('../controllers/groupChatController')
const activityController = require('../controllers/activityController')
const { auth, requireAdmin } = require('../middleware/auth')

router.use(auth)
router.get('/me', requireAdmin('stats.view'), controller.me)
router.get('/stats', requireAdmin('stats.view'), controller.stats)
router.get('/reports', requireAdmin('content.manage'), controller.listReports)
router.put('/reports/:id', requireAdmin('content.manage'), controller.updateReport)
router.get('/posts', requireAdmin('content.manage'), controller.listPosts)
router.put('/posts/:id', requireAdmin('content.manage'), controller.updatePost)
router.post('/posts/:id/action', requireAdmin('content.manage'), controller.postAction)
router.post('/posts/batch-action', requireAdmin('content.manage'), controller.batchPostAction)
router.get('/content', requireAdmin('config.manage'), controller.listContent)
router.post('/content', requireAdmin('config.manage'), controller.createContent)
router.put('/content/:id', requireAdmin('config.manage'), controller.updateContent)
router.delete('/content/:id', requireAdmin('config.manage'), controller.deleteContent)
router.get('/features', requireAdmin('config.manage'), controller.listFeatures)
router.put('/features', requireAdmin('config.manage'), controller.saveFeature)
router.get('/items', requireAdmin('item.manage'), controller.listItems)
router.post('/items', requireAdmin('item.manage'), controller.createItem)
router.put('/items/:id', requireAdmin('item.manage'), controller.updateItem)
router.get('/users', requireAdmin('user.manage'), controller.listUsers)
router.put('/users/:id/status', requireAdmin('user.manage'), controller.updateUserStatus)
router.put('/users/:id/role', requireAdmin('role.assign'), controller.updateUserRole)
router.put('/users/:id/cert-label', requireAdmin('user.manage'), controller.updateUserCertLabel)
router.get('/withdrawals', requireAdmin('payment.manage'), walletController.listWithdrawals)
router.post('/withdrawals/:id/review', requireAdmin('payment.manage'), walletController.reviewWithdrawal)
router.get('/rider-verifications', requireAdmin('user.manage'), controller.listRiderVerifications)
router.post('/rider-verifications/:id/review', requireAdmin('user.manage'), controller.reviewRiderVerification)

// 管理员账号管理 / 操作日志（admin.manage 权限仅超级管理员持有）
router.get('/admins', requireAdmin('admin.manage'), controller.listAdmins)
router.post('/admins', requireAdmin('admin.manage'), controller.createAdmin)
router.get('/audit-logs', requireAdmin('admin.manage'), controller.listAuditLogs)

// 跑腿订单流程（日志 tab：xx 发布订单 → xx 接单 → 完成/取消 全流程与双方用户信息）
router.get('/errand-orders', requireAdmin('admin.manage'), controller.listErrandOrders)
router.get('/errand-orders/:id', requireAdmin('admin.manage'), controller.errandOrderDetail)

// 社团&组织管理（config.manage 权限）
router.get('/club/categories', requireAdmin('config.manage'), clubController.adminListCategories)
router.post('/club/categories', requireAdmin('config.manage'), clubController.createCategory)
router.put('/club/categories/:id', requireAdmin('config.manage'), clubController.updateCategory)
router.delete('/club/categories/:id', requireAdmin('config.manage'), clubController.deleteCategory)
router.post('/club/clubs', requireAdmin('config.manage'), clubController.createClub)
router.put('/club/clubs/:id', requireAdmin('config.manage'), clubController.updateClub)
router.delete('/club/clubs/:id', requireAdmin('config.manage'), clubController.deleteClub)

// 广轻群聊管理（config.manage 权限）
router.get('/group-chat/applies', requireAdmin('config.manage'), groupChatController.adminListApplies)
router.post('/group-chat/applies/:id/review', requireAdmin('config.manage'), groupChatController.reviewApply)
router.get('/group-chat/groups', requireAdmin('config.manage'), groupChatController.adminListGroups)
router.post('/group-chat/groups', requireAdmin('config.manage'), groupChatController.createGroup)
router.put('/group-chat/groups/:id', requireAdmin('config.manage'), groupChatController.updateGroup)
router.delete('/group-chat/groups/:id', requireAdmin('config.manage'), groupChatController.deleteGroup)

// 校园活动管理（content.manage 权限）
router.get('/activities', requireAdmin('content.manage'), activityController.adminList)
router.put('/activities/:id', requireAdmin('content.manage'), activityController.adminUpdate)
router.delete('/activities/:id', requireAdmin('content.manage'), activityController.adminDelete)

module.exports = router
