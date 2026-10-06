const request = require('../../utils/request')

const get = (path, data) => request.get('/admin' + path, data || {}, true)
const post = (path, data, opts) => request.post('/admin' + path, data || {}, true, opts)
const put = (path, data) => request.put('/admin' + path, data || {}, true)
const del = (path, data) => request.del('/admin' + path, data || {}, true)

module.exports = {
  me: () => get('/me'),
  stats: () => get('/stats'),
  pendingCount: () => request.get('/admin/pending-count', {}, true, { silent: true }).then((d) => d || null),
  reports: (data) => get('/reports', data),
  updateReport: (id, status, note) => put('/reports/' + id, { status, note: note || '' }),
  posts: (data) => get('/posts', data),
  updatePost: (id, data) => put('/posts/' + id, data),
  postAction: (id, action) => post('/posts/' + id + '/action', { action }),
  batchPostAction: (ids, action) => post('/posts/batch-action', { ids, action }),
  content: (type) => get('/content', type ? { type } : {}),
  createContent: (data) => post('/content', data),
  updateContent: (id, data) => put('/content/' + id, data),
  deleteContent: (id) => del('/content/' + id),
  features: () => get('/features'),
  saveFeature: (data) => put('/features', data),
  items: () => get('/items'),
  createItem: (data) => post('/items', data),
  updateItem: (id, data) => put('/items/' + id, data),
  // 校园卡自定义页面（可多张）：列表走 /config 读接口（带 token 可读到下线草稿）；
  // 新增/编辑跳 pages/banner-detail?scope=campusCard[&id=]，上下架与删除在本页完成
  campusCardPages: () => request.get('/config/campus-card-pages', {}, true, { silent: true }).then((d) => (d && d.list) || []),
  updateCampusCardPage: (id, data) => request.put('/config/campus-card-page/' + id, data, true),
  deleteCampusCardPage: (id) => request.del('/config/campus-card-page/' + id, {}, true),
  // 信息推送群卡片（config.manage）：首页悬浮微信入口落地页的内容维护
  pushGroups: () => request.get('/config/push-groups', {}, true, { silent: true }).then((d) => (d && d.list) || []),
  createPushGroup: (data) => request.post('/config/push-group', data, true),
  savePushGroup: (id, data) => request.put('/config/push-group/' + id, data, true),
  deletePushGroup: (id) => request.del('/config/push-group/' + id, {}, true),
  // 驾校运营位（config.manage）：列表页横幅、筛选标签池、学车指南自定义页
  drivingPromo: () => request.get('/config/driving-promo', {}, true, { silent: true }),
  saveDrivingPromo: (data) => request.put('/config/driving-promo', data, true),
  drivingServiceTags: () => request.get('/config/driving-service-tags', {}, true, { silent: true }),
  saveDrivingServiceTags: (data) => request.put('/config/driving-service-tags', data, true),
  drivingGuidePage: () => request.get('/config/driving-guide-page', {}, true, { silent: true }),
  // 校园圈学车落地页（找驾校横幅跳转目标，与学车指南独立）
  promoLandingPage: () => request.get('/config/promo-landing-page', {}, true, { silent: true }),
  // 校园市场四分类自定义页（每类一张）：编辑跳 pages/banner-detail?scope=market&category=<key>&edit=1
  marketPage: (category) => request.get('/config/market-page/' + category, {}, true, { silent: true }).then((d) => d || null),
  services: () => get('/services'),
  createService: (data) => post('/services', data),
  updateService: (id, data) => put('/services/' + id, data),
  deleteService: (id) => del('/services/' + id),
  // 找驾校内容管理（config.manage 权限）
  drivingSchools: () => get('/driving-schools'),
  createDrivingSchool: (data) => post('/driving-schools', data),
  updateDrivingSchool: (id, data) => put('/driving-schools/' + id, data),
  deleteDrivingSchool: (id) => del('/driving-schools/' + id),
  // 评分对象治理（config.manage）：软删与恢复
  reviewTargets: (data) => get('/review-targets', data),
  deleteReviewTarget: (id) => del('/review-targets/' + id),
  restoreReviewTarget: (id) => post('/review-targets/' + id + '/restore'),
  users: (data) => get('/users', data),
  updateUserStatus: (id, status) => put('/users/' + id + '/status', { status }),
  updateUserRole: (id, role) => put('/users/' + id + '/role', { role }),
  withdrawals: (data) => get('/withdrawals', data),
  reviewWithdrawal: (id, action, note, opts) => post('/withdrawals/' + id + '/review', { action, note: note || '' }, opts),
  updateCertLabel: (id, certLabel) => put('/users/' + id + '/cert-label', { certLabel: certLabel || '' }),
  riderVerifications: (data) => get('/rider-verifications', data),
  reviewRiderVerification: (id, action, note) => post('/rider-verifications/' + id + '/review', { action, note: note || '' }),
  admins: () => get('/admins'),
  createAdmin: (query, role) => post('/admins', { query, role }),
  auditLogs: (data) => get('/audit-logs', data),
  errandOrders: (data) => get('/errand-orders', data),
  errandOrderDetail: (id) => get('/errand-orders/' + id),
  // 异议订单裁决：approve=异议成立（订单取消并原路退款）/ reject=异议不成立（订单成立并结算给接单方）
  reviewErrandDispute: (id, action, note) => post('/errand-disputes/' + id + '/review', { action, note: note || '' }),
  // 接单完成率与冻结名单（冻结为冷却期，可手动提前解除）
  errandRunners: (data) => get('/errand-runners', data),
  unfreezeErrandRunner: (userId, note) => post('/errand-runners/' + userId + '/unfreeze', { note: note || '' }),
  // 社团&组织管理
  clubCategories: () => get('/club/categories'),
  createClubCategory: (data) => post('/club/categories', data),
  updateClubCategory: (id, data) => put('/club/categories/' + id, data),
  deleteClubCategory: (id) => del('/club/categories/' + id),
  createClub: (data) => post('/club/clubs', data),
  updateClub: (id, data) => put('/club/clubs/' + id, data),
  deleteClub: (id) => del('/club/clubs/' + id),
  // 社团审核（用户端提交的社团申请，通过后才在用户端分类中展示）
  clubApplies: (data) => get('/club/applies', data),
  reviewClubApply: (id, action, note) => post('/club/applies/' + id + '/review', { action, note: note || '' }),
  // 广轻群聊管理
  groupChatApplies: (data) => get('/group-chat/applies', data),
  reviewGroupChatApply: (id, action, note) => post('/group-chat/applies/' + id + '/review', { action, note: note || '' }),
  groupChatGroups: (data) => get('/group-chat/groups', data),
  createGroupChatGroup: (data) => post('/group-chat/groups', data),
  updateGroupChatGroup: (id, data) => put('/group-chat/groups/' + id, data),
  deleteGroupChatGroup: (id) => del('/group-chat/groups/' + id),
  // 群聊类别编辑
  groupChatCategories: () => get('/group-chat/categories'),
  createGroupChatCategory: (data) => post('/group-chat/categories', data),
  updateGroupChatCategory: (id, data) => put('/group-chat/categories/' + id, data),
  deleteGroupChatCategory: (id) => del('/group-chat/categories/' + id),
  // 校园活动管理
  activities: (data) => get('/activities', data),
  activitySignups: (id, data) => get('/activities/' + id + '/signups', data),
  updateActivity: (id, data) => put('/activities/' + id, data),
  deleteActivity: (id) => del('/activities/' + id),
  // 活动审核（普通用户发布需审核）
  activityAudits: (data) => get('/activity-audits', data),
  auditActivity: (id, action, note) => post('/activities/' + id + '/audit', { action, note: note || '' }),
  // 订阅消息发送流水（客服排查「用户反馈收不到微信通知」）
  subscribeLogs: (data) => get('/subscribe-logs', data),
  // 维修预约记录（日志 tab → 维修信息）：用户提交的预约维修 + 提交人资料
  repairOrders: (data) => get('/repair-orders', data)
}
