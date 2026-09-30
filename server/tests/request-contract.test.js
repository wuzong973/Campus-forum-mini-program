const assert = require('assert')
const fs = require('fs')
const path = require('path')

const migration = fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrations.js'), 'utf8')
const errandRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'errandRoutes.js'), 'utf8')
const errandController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'errandController.js'), 'utf8')
const publishPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'errand-publish', 'index.js'), 'utf8')
const scheduleRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'scheduleRoutes.js'), 'utf8')
const adminRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminRoutes.js'), 'utf8')
const activityController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'activityController.js'), 'utf8')
const scheduleController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'scheduleController.js'), 'utf8')
const ocrPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-schedule', 'schedule-ocr', 'index.js'), 'utf8')
const clubRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'clubRoutes.js'), 'utf8')
const clubController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'clubController.js'), 'utf8')
const adminApi = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'utils', 'admin.js'), 'utf8')
const clubApplyPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'club', 'apply.js'), 'utf8')
const clubApplyWxml = fs.readFileSync(path.join(__dirname, '..', '..', 'pages', 'club', 'apply.wxml'), 'utf8')

assert.match(migration, /ensureColumn\('errand_order', 'is_large_item'/)
assert.match(migration, /ensureColumn\('errand_order', 'is_urgent'/)
assert.match(migration, /ensureColumn\('errand_order', 'payment_status'/)
assert.match(errandRoutes, /router\.post\('\/:id\/pay', auth, idempotency, paymentController\.createErrandPayment\)/)
assert.match(errandRoutes, /router\.get\('\/:id\/payment-status', auth, paymentController\.queryErrandPaymentStatus\)/)
assert.match(errandController, /WHERE e\.payment_status = 'SUCCESS'/)
assert.match(publishPage, /wx\.requestPayment/)
assert.match(publishPage, /\/errand\/'.*'\/pay'/)
assert.match(scheduleRoutes, /router\.post\('\/replace', auth, idempotency, scheduleController\.replace\)/)
assert.match(scheduleController, /未能识别出有效课程，请上传清晰完整的课表截图/)
assert.doesNotMatch(scheduleController, /demo-fallback|大学英语\(下\)|机械制图|军体课/)
assert.match(ocrPage, /api\.replaceSchedule\(courses\)/)
// 活动报名名单（活动详情）：仅管理员可读，且必须返回手机号等字段所需的表关联
assert.match(adminRoutes, /router\.get\('\/activities\/:id\/signups', requireAdmin\('content\.manage'\), activityController\.adminSignups\)/)
assert.match(activityController, /FROM activity_signup s LEFT JOIN sys_user u ON u\.id = s\.user_id/)
assert.match(activityController, /phone: r\.phone \|\| ''/)

// 社团申请链路：用户端提交 → 管理端审核 → 通过后落到 club 表（用户端「社团&组织」分类才会同步显示）
assert.match(migration, /CREATE TABLE IF NOT EXISTS club_apply/)
assert.match(migration, /ensureColumn\('club', 'apply_id'/)
assert.match(clubRoutes, /router\.post\('\/apply', auth, clubController\.submitApply\)/)
assert.match(clubRoutes, /router\.get\('\/mine', auth, clubController\.myApplies\)/)
assert.match(adminRoutes, /router\.get\('\/club\/applies', requireAdmin\('config\.manage'\), clubController\.adminListApplies\)/)
assert.match(adminRoutes, /router\.post\('\/club\/applies\/:id\/review', requireAdmin\('config\.manage'\), clubController\.reviewApply\)/)
assert.match(clubController, /INSERT INTO club \(apply_id, category_id, name, tags, intro, recruit, campus, sort_order, status\)/)
assert.match(clubController, /UPDATE club SET status = 0 WHERE apply_id = \? AND deleted = 0/)
// 管理端社团审核列表带出申请人昵称/头像/手机号（敏感字段仅管理端返回）
assert.match(clubController, /u\.nick_name, u\.avatar_url AS user_avatar, u\.phone AS user_phone/)
assert.match(adminApi, /reviewClubApply: \(id, action, note\) => post\('\/club\/applies\/' \+ id \+ '\/review'/)
// 用户端申请页：分类取服务端社团分类，提交走 /club/apply
assert.match(clubApplyPage, /api\.getClubCategories\(\)/)
assert.match(clubApplyPage, /api\.submitClubApply\(/)
assert.match(clubApplyWxml, /申请创建社团/)

// 群聊模块：在「群聊」子页下拆出「群聊信息 / 群聊审核」两个选项卡，
// 原「审核」菜单里的「群聊审核」子页迁移至此；原入口必须删除，避免同一份建群申请在两处维护
const adminPage = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.js'), 'utf8')
const adminWxml = fs.readFileSync(path.join(__dirname, '..', '..', 'pkg-admin', 'admin', 'index.wxml'), 'utf8')
assert.match(adminPage, /groupChatView: 'info'/, '群聊模块应有 info/audit 两个功能区的默认状态')
assert.match(adminPage, /switchGroupChatView\(e\) \{/, '群聊模块应有功能区切换方法')
assert.match(
  adminPage,
  /if \(this\.data\.groupChatView === 'audit'\) await this\.loadGroupChatApplies\(\)/,
  '群聊审核视图应只加载建群申请'
)
assert.doesNotMatch(adminPage, /key: 'groupAudit'/, '「审核」菜单下不应再保留 groupAudit 子页')
assert.doesNotMatch(
  adminPage,
  /review: \['payment\.manage', 'user\.manage', 'content\.manage', 'config\.manage'\]/,
  '「审核」菜单父级不再需要 config\.manage 权限'
)
assert.doesNotMatch(adminWxml, /activeSubTab === 'groupAudit'/, 'wxml 中不应再残留原 groupAudit 视图')
assert.match(adminWxml, /data-view="info" bindtap="switchGroupChatView">群聊信息</, '应有「群聊信息」选项卡')
assert.match(adminWxml, /data-view="audit" bindtap="switchGroupChatView">群聊审核</, '应有「群聊审核」选项卡')
assert.match(
  adminWxml,
  /activeTab === 'clubGroup' && activeSubTab === 'groupChat' && groupChatView === 'audit'/,
  '群聊审核列表应挂在群聊模块的 audit 视图下'
)
// 迁移后原有功能与字段必须保留：详情弹窗、通过/驳回、类型/类别/校区与申请人手机号
assert.match(adminWxml, /bindtap="viewChatApply"/, '群聊审核的「详情」入口应保留')
assert.match(adminWxml, /bindtap="openChatReview"/, '群聊审核的通过/驳回入口应保留')
assert.match(adminWxml, /类型：\{\{item\.groupType \|\| '微信群'\}\} · 类别：/, '群聊审核卡片字段应保留')
assert.match(adminWxml, /item\.creatorPhone \|\| '未绑定手机号'/, '群聊审核申请人手机号应保留')

// 维修信息（日志 tab 的第三个分段，位置在「订阅消息」右侧）
// 背景：用户端提交的预约维修只落 repair_order 表，管理员此前没有任何入口能看到，
// 只能在用户端「我的订单」里看自己下的单 —— 这里钉死管理端入口、字段与位置。
const repairRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'repairRoutes.js'), 'utf8')
const repairController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'repairController.js'), 'utf8')
assert.match(repairRoutes, /router\.get\('\/orders', auth, controller\.listMine\)/, '用户端「我的订单」接口应保留')
// 注意锚点 `^`：不带行首锚点时，被注释掉的 `// router.get(...)` 也会匹配，反向验证会假绿
assert.match(
  adminRoutes,
  /^\s*router\.get\('\/repair-orders', requireAdmin\('admin\.manage'\), repairController\.adminListOrders\)/m,
  '维修信息接口应挂在日志 tab 同一权限（admin.manage）下'
)
// 只对管理端控制器切片做断言：create 里也有这些字段名，全文件 includes 会假绿
const adminRepairBlock = repairController.slice(repairController.indexOf('exports.adminListOrders'))
assert.ok(adminRepairBlock.length > 300, '应存在管理端维修预约列表控制器')
assert.match(adminRepairBlock, /FROM repair_order r LEFT JOIN sys_user u ON u\.id = r\.user_id/, '列表必须带出提交人资料')
assert.match(adminRepairBlock, /u\.nick_name nickName, u\.avatar_url avatarUrl, u\.phone userPhone/, '昵称/头像/注册手机号字段名应稳定')
// 头像键名必须是 avatarUrl：success() 的 normalizeAvatars 只按 AVATAR_KEYS 白名单修正历史头像路径，
// 换成 userAvatar 这类自定义键名会静默绕过修正（老用户头像显示灰圆）
assert.doesNotMatch(adminRepairBlock, /userAvatar|userNickName/, '维修列表不得使用自定义头像/昵称键名')
// 上门服务所需的字段：联系方式、上门地址、预约时间、服务内容、故障照片
for (const field of ['r.contact_name contactName', 'r.contact_phone contactPhone', 'r.wechat_id wechatId',
  'r.service_address serviceAddress', 'r.expected_time expectedTime', 'r.description', 'r.images', 'r.paid_at paidAt']) {
  assert.ok(adminRepairBlock.includes(field), `管理端维修列表应返回 ${field}`)
}
// images 是 JSON 列，三种形态都要归一化，否则前端 `.length` 会把对象当数组用
assert.match(adminRepairBlock, /images: parseImages\(row\.images\)/, 'images 必须经 parseImages 归一化')
assert.match(adminApi, /^\s*repairOrders: \(data\) => get\('\/repair-orders', data\),?$/m, '客户端 API 应有一行 repairOrders')
assert.match(adminPage, /REPAIR_STATUS_TEXT = \{ unpaid: '待支付'/, '管理端应有维修状态文案表（状态映射按模块各写一份）')
assert.match(adminPage, /logScope === 'repair'\) await this\.loadRepairOrders\(1\)/, 'loadCurrent 应能加载维修信息')
assert.match(adminPage, /^\s*async loadRepairOrders\(page\) \{/m, '应有维修列表加载方法')
assert.match(adminPage, /statusClass: REPAIR_STATUS_CLASS\[row\.status\]/, '状态胶囊配色应随状态映射下发')
// 位置断言：「维修信息」入口必须在「订阅消息」右侧
assert.match(
  adminWxml,
  /data-scope="subscribe" bindtap="chooseLogScope">订阅消息<\/view>\s*<view class="scope-tab[^>]*data-scope="repair" bindtap="chooseLogScope">维修信息<\/view>/,
  '「维修信息」入口应位于「订阅消息」右侧'
)
assert.match(adminWxml, /wx:if="\{\{logScope === 'repair'\}\}"/, '应有维修信息列表区块')
// 卡片上必须具备用户头像、昵称、联系方式、预约时间、上门地址、上门服务内容
for (const field of ['item.avatarUrl', 'item.nickName', 'item.contactPhone', 'item.expectedTime',
  'item.serviceAddress', 'item.serviceText']) {
  assert.ok(adminWxml.includes(field), `维修卡片应展示 ${field}`)
}
// 完整性入口：点卡片看完整资料 + 复制联系方式
assert.match(adminWxml, /bindtap="openRepairDetail"/, '应有维修详情入口')
assert.match(adminWxml, /bindtap="copyRepairContact"/, '应支持复制联系方式')

global.getApp = () => ({ globalData: { token: '' } })
const { sanitizeQuery } = require('../../utils/request')

assert.deepStrictEqual(
  sanitizeQuery({ type: '', campus: undefined, minPrice: null, page: 1, enabled: false, count: 0 }),
  { page: 1, enabled: false, count: 0 },
)

console.log('Request schema migration checks passed.')
