const express = require('express')
const router = express.Router()
const controller = require('../controllers/adminController')
const walletController = require('../controllers/walletController')
const clubController = require('../controllers/clubController')
const groupChatController = require('../controllers/groupChatController')
const activityController = require('../controllers/activityController')
const repairController = require('../controllers/repairController')
const drivingSchoolController = require('../controllers/drivingSchoolController')
const reviewController = require('../controllers/reviewController')
const broadcastController = require('../controllers/broadcastController')
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
// 服务宫格项管理（外部小程序/图标/链接可配置）
router.get('/services', requireAdmin('config.manage'), controller.listServices)
router.post('/services', requireAdmin('config.manage'), controller.createService)
router.put('/services/:id', requireAdmin('config.manage'), controller.updateService)
router.delete('/services/:id', requireAdmin('config.manage'), controller.deleteService)
// 找驾校内容管理（config.manage 权限）：新增/编辑/删除驾校条目
router.get('/driving-schools', requireAdmin('config.manage'), drivingSchoolController.adminList)
router.post('/driving-schools', requireAdmin('config.manage'), drivingSchoolController.adminCreate)
router.put('/driving-schools/:id', requireAdmin('config.manage'), drivingSchoolController.adminUpdate)
router.delete('/driving-schools/:id', requireAdmin('config.manage'), drivingSchoolController.adminDelete)
// 评分对象治理（config.manage 权限）：列表/软删/恢复，删除为软删可在「已删除」里恢复
router.get('/review-targets', requireAdmin('config.manage'), reviewController.adminTargets)
router.delete('/review-targets/:id', requireAdmin('config.manage'), reviewController.adminDeleteTarget)
router.post('/review-targets/:id/restore', requireAdmin('config.manage'), reviewController.adminRestoreTarget)
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
// 订阅消息发送流水：客服排查「用户反馈收不到微信通知」
router.get('/subscribe-logs', requireAdmin('admin.manage'), controller.listSubscribeLogs)

// 维修预约记录（日志 tab → 维修信息）：用户提交的预约维修 + 提交人资料
router.get('/repair-orders', requireAdmin('admin.manage'), repairController.adminListOrders)

// 跑腿订单流程（日志 tab：xx 发布订单 → xx 接单 → 完成/取消 全流程与双方用户信息）
router.get('/errand-orders', requireAdmin('admin.manage'), controller.listErrandOrders)
router.get('/errand-orders/:id', requireAdmin('admin.manage'), controller.errandOrderDetail)
// 异议订单裁决：approve=异议成立（订单取消并原路退款）/ reject=异议不成立（订单成立并结算给接单方）
router.post('/errand-disputes/:id/review', requireAdmin('admin.manage'), controller.reviewErrandDispute)

// 社团&组织管理（config.manage 权限）
router.get('/club/categories', requireAdmin('config.manage'), clubController.adminListCategories)
router.post('/club/categories', requireAdmin('config.manage'), clubController.createCategory)
router.put('/club/categories/:id', requireAdmin('config.manage'), clubController.updateCategory)
router.delete('/club/categories/:id', requireAdmin('config.manage'), clubController.deleteCategory)
router.post('/club/clubs', requireAdmin('config.manage'), clubController.createClub)
router.put('/club/clubs/:id', requireAdmin('config.manage'), clubController.updateClub)
router.delete('/club/clubs/:id', requireAdmin('config.manage'), clubController.deleteClub)
// 社团审核（用户端提交的社团申请，审核通过后才在用户端「社团&组织」分类中展示）
router.get('/club/applies', requireAdmin('config.manage'), clubController.adminListApplies)
router.post('/club/applies/:id/review', requireAdmin('config.manage'), clubController.reviewApply)

// 广轻群聊管理（config.manage 权限）
router.get('/group-chat/applies', requireAdmin('config.manage'), groupChatController.adminListApplies)
router.post('/group-chat/applies/:id/review', requireAdmin('config.manage'), groupChatController.reviewApply)
router.get('/group-chat/groups', requireAdmin('config.manage'), groupChatController.adminListGroups)
router.post('/group-chat/groups', requireAdmin('config.manage'), groupChatController.createGroup)
router.put('/group-chat/groups/:id', requireAdmin('config.manage'), groupChatController.updateGroup)
router.delete('/group-chat/groups/:id', requireAdmin('config.manage'), groupChatController.deleteGroup)
// 群聊类别编辑
router.get('/group-chat/categories', requireAdmin('config.manage'), groupChatController.adminListCategories)
router.post('/group-chat/categories', requireAdmin('config.manage'), groupChatController.createCategory)
router.put('/group-chat/categories/:id', requireAdmin('config.manage'), groupChatController.updateCategory)
router.delete('/group-chat/categories/:id', requireAdmin('config.manage'), groupChatController.deleteCategory)

// 校园活动管理（content.manage 权限）
router.get('/activities', requireAdmin('content.manage'), activityController.adminList)
// 活动报名名单（仅管理员可见）：头像、昵称、手机号、校区、报名时间
router.get('/activities/:id/signups', requireAdmin('content.manage'), activityController.adminSignups)
router.put('/activities/:id', requireAdmin('content.manage'), activityController.adminUpdate)
router.delete('/activities/:id', requireAdmin('content.manage'), activityController.adminDelete)
// 活动审核（普通用户发布的活动需审核通过后才公开）
router.get('/activity-audits', requireAdmin('content.manage'), activityController.adminAuditList)
router.post('/activities/:id/audit', requireAdmin('content.manage'), activityController.adminAudit)

// 微信群播报（论坛广播）：生成新帖摘要+小程序短链的群发文案（content.manage 权限）
router.get('/broadcasts', requireAdmin('content.manage'), broadcastController.list)
router.post('/broadcasts/run', requireAdmin('content.manage'), broadcastController.runNow)

module.exports = router
