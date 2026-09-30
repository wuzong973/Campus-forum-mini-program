const express = require('express')
const router = express.Router()
const drivingSchoolController = require('../controllers/drivingSchoolController')

// 公开读取：列表（可按校区过滤）与详情，仅返回启用条目
router.get('/list', drivingSchoolController.list)
router.get('/detail/:id', drivingSchoolController.detail)

module.exports = router
