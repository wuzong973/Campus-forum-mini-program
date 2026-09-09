const express = require('express')
const router = express.Router()
const clubController = require('../controllers/clubController')

// 公开接口：社团&组织分类（含分类下社团列表）
router.get('/categories', clubController.listCategories)

module.exports = router
