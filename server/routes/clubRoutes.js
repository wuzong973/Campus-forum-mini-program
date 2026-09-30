const express = require('express')
const router = express.Router()
const clubController = require('../controllers/clubController')
const { auth } = require('../middleware/auth')

// 公开接口：社团&组织分类（含分类下社团列表）
router.get('/categories', clubController.listCategories)
// 公开接口：单个社团详情（按社团 id 匹配，不存在/已下线返回 404）
// 注意：必须放在 /categories、/mine 等静态路径之后，避免被通配路径抢先匹配
router.get('/detail/:id', clubController.detail)

// 用户端：提交社团申请 / 查看我的申请（需登录，审核通过后才在分类中展示）
router.post('/apply', auth, clubController.submitApply)
router.get('/mine', auth, clubController.myApplies)

module.exports = router
