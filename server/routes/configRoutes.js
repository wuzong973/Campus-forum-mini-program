const express = require('express')
const router = express.Router()
const controller = require('../controllers/configController')
const { auth, optionalAuth, requireAdmin } = require('../middleware/auth')

router.get('/home', controller.home)
router.get('/app-version', controller.appVersion)

// 消息通知横幅：公开读取（管理员额外可读已下线草稿）；保存需管理员权限
router.get('/message-banner', optionalAuth, controller.messageBanner)
router.put('/message-banner', auth, requireAdmin('config.manage'), controller.saveMessageBanner)

// 帖子详情页「每日热榜」上方横幅：机制同上，内容独立
router.get('/post-banner', optionalAuth, controller.postBanner)
router.put('/post-banner', auth, requireAdmin('config.manage'), controller.savePostBanner)

// 校园卡自定义页面（可多张）：管理后台「物品」页维护，普通用户只读
router.get('/campus-card-pages', optionalAuth, controller.campusCardPages)
router.get('/campus-card-page/:id', optionalAuth, controller.campusCardPageById)
router.post('/campus-card-page', auth, requireAdmin('config.manage'), controller.createCampusCardPage)
router.put('/campus-card-page/:id', auth, requireAdmin('config.manage'), controller.saveCampusCardPage)
router.delete('/campus-card-page/:id', auth, requireAdmin('config.manage'), controller.deleteCampusCardPage)
// 无 id 的旧地址：返回排序最前的一张已发布页面，供更新前的线上小程序版本读取
router.get('/campus-card-page', optionalAuth, controller.campusCardPage)

// 学车指南自定义页（校园卡同款，单张）：后台「物品」页编辑，普通用户只读
router.get('/driving-guide-page', optionalAuth, controller.drivingGuidePage)
router.post('/driving-guide-page', auth, requireAdmin('config.manage'), controller.createDrivingGuidePage)
router.put('/driving-guide-page/:id', auth, requireAdmin('config.manage'), controller.saveDrivingGuidePage)

// 校园市场四分类自定义页（校园卡同款，每类一张）：后台「物品」页编辑，普通用户只读
// category: rental=租赁服务 / digital=校园数码 / housekeeping=校园家政 / diypc=DIY电脑
router.get('/market-page/:category', optionalAuth, controller.marketPage)
router.post('/market-page/:category', auth, requireAdmin('config.manage'), controller.createMarketPage)
router.put('/market-page/:category/:id', auth, requireAdmin('config.manage'), controller.saveMarketPage)

// 校园圈学车落地页（列表页顶部横幅跳转目标；与「学车指南」各自独立编辑）
router.get('/promo-landing-page', optionalAuth, controller.promoLandingPage)
router.post('/promo-landing-page', auth, requireAdmin('config.manage'), controller.createPromoLandingPage)
router.put('/promo-landing-page/:id', auth, requireAdmin('config.manage'), controller.savePromoLandingPage)

// 驾校运营位：列表页顶部横幅（背景图+文案+标签）、筛选面板的服务保障标签池
router.get('/driving-promo', optionalAuth, controller.drivingPromo)
router.put('/driving-promo', auth, requireAdmin('config.manage'), controller.saveDrivingPromo)
router.get('/driving-service-tags', optionalAuth, controller.drivingServiceTags)
router.put('/driving-service-tags', auth, requireAdmin('config.manage'), controller.saveDrivingServiceTags)

module.exports = router
