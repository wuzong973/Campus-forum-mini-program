const admin = require('../utils/admin')
const wechat = require('../../utils/wechat')
const qr = require('../../utils/qr')
const { runPullDownRefresh } = require('../../utils/refresh')
const drivingSchool = require('../../utils/driving-school')
// 卡片动效降级开关（低端机 / 设置页关闭），样式见 styles/card-fx.wxss
const motion = require('../../utils/motion')

// 提现账单状态文案（与 walletController 状态机对齐；打款失败的单会回到 PENDING 并带 last_error）
const WITHDRAWAL_STATUS_TEXT = {
  PENDING: '待审核',
  PROCESSING: '打款处理中',
  WAIT_CONFIRM: '待收款确认',
  SUCCESS: '已成功',
  REJECTED: '已驳回',
  FAILED: '打款失败'
}

// 评分对象分类文案（与 reviewController.CATEGORIES 对齐）
const REVIEW_CATEGORY_TEXT = { course: '课程', canteen: '食堂', business: '商圈' }

const TAB_PERMISSIONS = {
  overview: 'stats.view',
  reports: 'content.manage',
  posts: 'content.manage',
  content: 'config.manage',
  items: 'item.manage',
  services: 'config.manage',
  clubGroup: 'config.manage',
  activities: 'content.manage',
  // 合并父级菜单：拥有任一子页权限即可见（数组=或关系）
  userAdmin: ['user.manage', 'admin.manage'],
  // 「群聊审核」已迁移到「群聊/社团 → 群聊 → 群聊审核」，不再作为本菜单的子页，
  // 因此本菜单只需剩余三个子页的权限（提现/活动/认证）
  review: ['payment.manage', 'user.manage', 'content.manage'],
  logs: 'admin.manage'
}

// ===== 合并父级菜单的子页定义：perm 为该子页自身的可见权限 =====
const SUB_TABS = {
  clubGroup: [
    { key: 'groupChat', name: '群聊', perm: 'config.manage' },
    { key: 'clubs', name: '社团', perm: 'config.manage' }
  ],
  userAdmin: [
    { key: 'users', name: '用户', perm: 'user.manage' },
    { key: 'admins', name: '管理员', perm: 'admin.manage' }
  ],
  review: [
    { key: 'activityAudit', name: '活动审核', perm: 'content.manage' },
    { key: 'withdrawals', name: '提现审核', perm: 'payment.manage' },
    { key: 'riderVerifications', name: '认证审核', perm: 'user.manage' }
  ]
}

const ROLE_OPTIONS = ['user', 'content_admin', 'user_admin', 'operator', 'super_admin']
const ROLE_SHEET = ['普通用户', '内容管理员', '用户管理员', '运营管理员', '超级管理员']
// 新建管理员可选角色（不含普通用户）
const CREATE_ROLE_KEYS = ['content_admin', 'user_admin', 'operator', 'super_admin']
const CREATE_ROLE_NAMES = ['内容管理员', '用户管理员', '运营管理员', '超级管理员']
const ROLE_LABELS = {
  super_admin: '超级管理员',
  content_admin: '内容管理员',
  user_admin: '用户管理员',
  operator: '运营管理员',
  user: '普通用户'
}
const ROLE_PERMISSION_TEXT = {
  super_admin: '全部权限（含管理员管理与操作日志）',
  content_admin: '内容管理 · 内容配置 · 数据看板',
  user_admin: '用户管理 · 数据看板',
  operator: '物品管理 · 内容配置 · 数据看板 · 资金管理'
}
const STATS_POLL_MS = 15000

// 发布页横幅可选颜色（与小程序端 style-red/green/... 样式对应）
const BANNER_STYLE_VALUES = ['red', 'green', 'orange', 'blue', 'purple']
const BANNER_STYLE_NAMES = ['红色', '绿色', '橙色', '蓝色', '紫色']
const BANNER_STYLE_BG = { red: '#ffe2e2', green: '#e0f5e6', orange: '#fff1de', blue: '#e3edff', purple: '#f0e5ff' }
const BANNER_STYLE_FG = { red: '#e34d4d', green: '#3aa356', orange: '#e8930c', blue: '#3a6fe3', purple: '#8a4de0' }

// ===== 群聊管理：建群申请状态与可选群类别（与设计稿九大分类一致，顺序即展示顺序） =====
const GC_APPLY_STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '已驳回' }
const GC_CATEGORIES = ['学院群', '线下桌游群', '体育运动群', '老乡群', '学习竞赛', '交易群', '游戏群', '新生群']

// ===== 社团审核：用户端「申请创建社团」提交的申请状态（与服务端 club_apply.status 一致） =====
const CLUB_APPLY_STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '已驳回' }

// ===== 校区维度（与用户端 utils/campus.js 一致；'' = 全部校区，所有校区可见） =====
const CAMPUS_SELECT_OPTIONS = [
  { label: '全部校区', value: '' },
  { label: '广州校区', value: '广州校区' },
  { label: '佛山校区', value: '佛山校区' },
]

// ===== 群聊进群方式（与服务端 groupChatController 的 JOIN_MODES 及用户端
//       pages/group-chat/detail 的文案保持一致） =====
const JOIN_MODE_OPTIONS = [
  { label: '扫码进群', value: 'qrcode' },
  { label: '加管理员拉群', value: 'admin' },
  { label: '仅群成员邀请', value: 'invite' },
]
const JOIN_MODE_LABELS = JOIN_MODE_OPTIONS.map((item) => item.label)
const DEFAULT_JOIN_MODE = 'qrcode'
// 群成员规模展示上限（与服务端 MAX_MEMBER_COUNT 一致）
const MAX_MEMBER_COUNT = 100000

// 内容配置弹窗的标题与操作指引（与「页面横幅」编辑器风格统一）
const CONTENT_FORM_META = {
  notice: {
    title: '公告',
    guide: '操作指引：① 填写公告文字；② 按需配置右侧链接文字与跳转路径（默认显示"点此查看"，用户点击后跳转到所填页面路径；路径留空则弹出管理员微信二维码）；③ 按需配置尾部链接文字与链接图片；④ 可自定义背景颜色与文字颜色（实时预览）；⑤ 打开底部「启用状态」；⑥ 点击「保存并发布」，首页公告实时生效。首页公告取排序最前的启用条目。'
  },
  tag: {
    title: '标签',
    guide: '操作指引：① 填写标签名称，描述可留空；② 可自定义标签的背景颜色与文字颜色（配置列表中将按此颜色展示）；③ 打开底部「启用状态」；④ 点击「保存并发布」。'
  },
  banner: {
    title: '首页轮播',
    guide: '操作指引：① 填写主标题并上传轮播图片（建议宽高比 16:9）；② 按需填写描述、角标、跳转路径，并可点击挑选主题色（实时预览）；③ 打开底部「启用状态」；④ 点击「保存并发布」。启用中的轮播按排序展示在首页顶部，未配置时显示默认轮播。'
  },
  publish_banner: {
    title: '发布横幅',
    guide: '操作指引：① 填写横幅文字；② 选择预设配色，或点击「背景颜色 / 文字颜色」自定义颜色（实时预览，保存后在发布页生效）；③ 按需填写跳转链接（用户点击横幅后跳转，支持 /pages/... 页面路径或 https 网页）与详情标题/详情内容（横幅详情页展示）；④ 打开底部「启用状态」；⑤ 点击「保存并发布」。横幅展示在「发布帖子」「发布跑腿」页顶部，多条启用横幅按排序自动左右轮播。'
  }
}

function pad2(n) { return (n < 10 ? '0' : '') + n }

// ===== 管理操作日志的可读化描述 =====
const CONTENT_TYPE_NAMES = {
  category: '分类', tag: '标签', notice: '公告', banner: '首页轮播', publish_banner: '发布横幅', message_banner: '消息通知横幅', post_banner: '热榜横幅'
}
const TARGET_TYPE_NAMES = {
  post: '帖子', content: '内容配置', virtual_item: '虚拟物品', user: '用户', feature: '功能开关',
  content_report: '举报', rider_verification: '骑手认证', wallet_withdrawal: '提现申请', admin: '管理员',
  club_category: '社团分类', club: '社团', club_apply: '社团申请', group_chat_apply: '建群申请', group_chat: '群聊',
  group_category: '群聊类别',
  campus_activity: '校园活动'
}
const ACTION_TEXT_MAP = {
  'content.create': '新增内容配置',
  'content.update': '更新内容配置',
  'content.delete': '删除内容配置',
  'reviewTarget.delete': '删除评分对象',
  'reviewTarget.restore': '恢复评分对象',
  'feature.save': '保存功能开关',
  'post.edit': '编辑帖子',
  'post.approve': '审核通过帖子',
  'post.reject': '驳回帖子',
  'post.hide': '隐藏帖子',
  'post.delete': '删除帖子',
  'post.pin': '置顶帖子',
  'post.unpin': '取消置顶帖子',
  'post.review_note': '填写帖子审核备注',
  'post.not_interested': '设置帖子不感兴趣',
  'post.batch.approve': '批量审核通过帖子',
  'post.batch.hide': '批量隐藏帖子',
  'post.batch.delete': '批量删除帖子',
  'post.batch.pin': '批量置顶帖子',
  'post.batch.unpin': '批量取消置顶帖子',
  'item.create': '新增虚拟物品',
  'item.update': '更新虚拟物品',
  'user.enable': '启用用户账号',
  'user.disable': '禁用用户账号',
  'user.role': '调整用户角色',
  'user.cert_label': '设置用户认证标签',
  'admin.create': '新增管理员',
  'report.update': '处理举报',
  'rider_verification.approve': '通过骑手认证',
  'rider_verification.reject': '驳回骑手认证',
  'wallet.withdrawal.approve': '通过提现申请',
  'wallet.withdrawal.reject': '驳回提现申请',
  'club.category.create': '新增社团分类',
  'club.category.update': '更新社团分类',
  'club.category.delete': '删除社团分类',
  'club.club.create': '新增社团',
  'club.club.update': '更新社团',
  'club.club.delete': '删除社团',
  'club.apply.approve': '通过社团申请',
  'club.apply.reject': '驳回社团申请',
  'groupchat.apply.approve': '通过建群申请',
  'groupchat.apply.reject': '驳回建群申请',
  'groupchat.group.create': '新增群聊',
  'groupchat.group.update': '更新群聊',
  'groupchat.group.delete': '删除群聊',
  'activity.update': '更新校园活动',
  'activity.delete': '删除校园活动'
}

// 活动状态徽标文案（与用户端一致）
const ACTIVITY_BADGE_TEXT = { signing: '报名中', notStarted: '报名未开始', ended: '已结束' }
const ACTIVITY_AUDIT_STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '已驳回' }

// 把一条审计记录转换为详细的中文描述：{ actionText, targetText, timeText }
function describeAudit(row) {
  const action = String(row.action || '')
  let detail = row.detail
  if (typeof detail === 'string') { try { detail = JSON.parse(detail) || {} } catch (e) { detail = {} } }
  detail = detail || {}
  let actionText = ACTION_TEXT_MAP[action] || ''
  if (!actionText) {
    if (action.indexOf('post.batch.') === 0) actionText = '批量处理帖子'
    else if (action.indexOf('rider_verification.') === 0) actionText = '处理骑手认证'
    else actionText = action
  }
  // 补充具体对象：内容配置带类型与标题、物品带名称、角色变更带前后值等
  if (action === 'content.create' || action === 'content.update' || action === 'content.delete') {
    const typeName = CONTENT_TYPE_NAMES[detail.type]
    if (typeName) actionText += '（' + typeName + (detail.title ? '「' + detail.title + '」' : '') + '）'
    if (action === 'content.update' && Array.isArray(detail.fields) && detail.fields.length) actionText += ' 字段：' + detail.fields.join('、')
  } else if (action.indexOf('item.') === 0 && detail.name) {
    actionText += '「' + detail.name + '」'
  } else if (action === 'user.role' && detail.to) {
    const roleNames = { content_admin: '内容管理员', user_admin: '用户管理员', operator: '运营管理员', super_admin: '超级管理员', user: '普通用户' }
    actionText += '（调整为' + (roleNames[detail.to] || detail.to) + '）'
  } else if (action === 'user.cert_label') {
    actionText += '「' + (detail.certLabel ? String(detail.certLabel) : '已清除') + '」'
  } else if (action === 'feature.save' && row.targetId) {
    actionText += '（' + row.targetId + '）'
  } else if (action.indexOf('post.batch.') === 0 && detail.count) {
    actionText += ' ' + detail.count + ' 条'
  } else if (action === 'report.update' && detail.status) {
    const statusNames = { processing: '受理', resolved: '解决', rejected: '驳回' }
    if (statusNames[detail.status]) actionText += '（' + statusNames[detail.status] + '）'
  } else if ((action.indexOf('club.category.') === 0 || action.indexOf('club.club.') === 0 || action.indexOf('groupchat.group.') === 0) && detail.name) {
    actionText += '「' + detail.name + '」'
  } else if (action.indexOf('groupchat.apply.') === 0) {
    if (detail.name) actionText += '「' + detail.name + '」'
    if (detail.note) actionText += ' 意见：' + detail.note
  } else if (action.indexOf('club.apply.') === 0) {
    if (detail.name) actionText += '「' + detail.name + '」'
    if (detail.note) actionText += ' 意见：' + detail.note
  }
  const targetName = TARGET_TYPE_NAMES[row.targetType] || row.targetType || ''
  const targetId = row.targetId ? ' #' + row.targetId : ''
  const targetText = targetName ? targetName + targetId : (row.targetId || '')
  const d = row.createdAt ? new Date(row.createdAt) : null
  const timeText = d && !isNaN(d.getTime())
    ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    : ''
  return { actionText, targetText, timeText }
}

// ===== 日志 tab：跑腿订单流程展示 =====
const ERRAND_STATUS_TEXT = { pending: '待接单', accepted: '进行中', finishing: '待确认', finished: '已完成', cancelled: '已取消', disputed: '有异议' }

// ===== 日志 tab：维修信息（用户提交的预约维修）=====
// 状态取值与 server/sql/init.sql 的 repair_order.status 一致。
// statusClass 复用日志页既有的 .st-xx 胶囊配色（wxml 里不写长三元，配色跟着状态表走）。
const REPAIR_STATUS_TEXT = { unpaid: '待支付', paid: '已支付', accepted: '已接单', repairing: '维修中', finished: '已完成', cancelled: '已取消' }
const REPAIR_STATUS_CLASS = { unpaid: 'pending', paid: 'accepted', accepted: 'accepted', repairing: 'finishing', finished: 'finished', cancelled: 'cancelled' }

// ===== 日志 tab：订阅消息发送流水 =====
// 客服排查「用户反馈收不到微信通知」看这里。状态语义与 server/services/subscribeService.js 一致：
//   sent 已交给微信（之后的到达时间由微信决定）· merged 被合并窗口去重（现会补发）
//   skipped 额度不足（没授权或次数用尽）· failed 发送失败（看 errcode：43101 拒收 / 47003 字段不符）
const SUBSCRIBE_STATUS_TEXT = { sent: '已发送', merged: '已合并', skipped: '额度不足', failed: '发送失败', throttled: '命中节流' }
const SUBSCRIBE_STATUS_HINT = {
  sent: '已成功交给微信，到达时间由微信决定',
  merged: '窗口内已发过同类，已转入待发补发',
  skipped: '用户没授权或授权次数已用尽',
  failed: '发送失败，看错误详情',
  // 命中节流是**客户端本地**判定的结果：该触发组当天已弹满 3 次，本次连微信都没调用。
  // 与 skipped 的区别：skipped 是服务端查额度不足，throttled 是本地弹窗次数用尽。
  throttled: '命中弹窗节流（该组当天已达 3 次上限，未调用微信）'
}
// 微信错误码 → 中文解释。
// 微信返回的 errmsg 是英文原文（如 `invalid credential, access_token is invalid or not latest`），
// 客服看日志时读不懂，这里给一句中文结论；**原文仍然照常展示**，方便对照微信官方文档排查。
const SUBSCRIBE_ERRCODE_HINT = {
  40001: '接口凭据失效（access_token 被其它实例刷新顶掉），系统已自动换新凭据重发',
  42001: '接口凭据已过期，系统已自动换新凭据重发',
  40014: '接口凭据非法',
  40003: 'openid 无效（用户不存在或未关注小程序）',
  43101: '用户拒收：没授权过，或授权次数已用尽（该模板额度已清零）',
  47003: '模板字段不符：字段名 / 长度 / 空值问题，需与微信后台模板逐字段核对',
  45009: '微信接口调用超限（限流）',
  43004: '需要接收者先关注小程序',
  '-1': '微信系统繁忙，稍后重试'
}
const ERRAND_PAYMENT_TEXT = { UNPAID: '未支付', PREPAY: '支付中', SUCCESS: '已支付', REFUNDING: '退款中', REFUNDED: '已退款', CLOSED: '已关闭' }
const ERRAND_LOG_TEXT = {
  created: '发布订单，等待同学接单',
  accepted: '接单，订单进行中',
  finish_submitted: '提交完成，等待发单人确认',
  confirmed: '发单人确认完成，赏金转入接单方钱包',
  auto_confirmed: '超时未确认，系统自动确认完成',
  disputed: '发单人提出异议，等待客服核实',
  dispute_approved: '客服判定异议成立，订单取消并退款',
  dispute_rejected: '客服驳回异议，订单成立并完成',
  finished: '完成订单',
  cancelled: '取消订单，赏金原路退回',
  cancel_requested: '申请取消接单',
  cancel_approved: '同意取消接单，订单终止',
  cancel_rejected: '拒绝取消接单申请',
  self_cancel: '因自身原因取消接单，赏金原路退回',
  timeout_cancelled: '超时未支付/无人接单，系统自动取消',
  deadline_cancelled: '超过截止接单时间，系统自动取消'
}

// DATETIME/ISO → 本地 'YYYY-MM-DD HH:mm:ss'，空值返回 ''
function fmtDateTime(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'))
  if (isNaN(d.getTime())) return ''
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

// 列表行展示：状态文案 + 「xx 发布订单 · xx 接单」过程描述
function formatErrandRow(row) {
  const publisher = row.publisherName || '未知用户'
  const acceptor = row.acceptorName || ''
  let flowText = publisher + ' 发布订单'
  if (row.status === 'pending') flowText += acceptor ? ' · ' + acceptor + ' 接单中' : ' · 暂无人接单'
  else if (row.status === 'accepted') flowText += ' · ' + (acceptor || '同学') + ' 已接单'
  else if (row.status === 'finishing') flowText += ' · ' + (acceptor || '同学') + ' 已提交完成，待发单人确认'
  else if (row.status === 'disputed') flowText += ' · ' + (acceptor || '同学') + ' 接单，发单人提出异议'
  else if (row.status === 'finished') flowText += ' · ' + (acceptor || '同学') + ' 接单并已完成'
  else if (row.status === 'cancelled') flowText += acceptor ? ' · ' + acceptor + ' 接单后订单已取消' : ' · 无人接单，订单已取消'
  return {
    statusText: ERRAND_STATUS_TEXT[row.status] || row.status,
    paymentText: ERRAND_PAYMENT_TEXT[row.paymentStatus] || '',
    flowText,
    lastDetailText: row.lastDetail || '',
    lastAtText: fmtDateTime(row.lastAt),
    createdAtText: fmtDateTime(row.createdAt),
    acceptedAtText: fmtDateTime(row.acceptedAt),
    finishedAtText: fmtDateTime(row.finishedAt),
    disputeReason: row.disputeReason || '',
    rewardText: Number(row.reward || 0).toFixed(2)
  }
}

// 异议处理结果文案（与后端 dispute_result 取值对应）
const ERRAND_DISPUTE_RESULT_TEXT = { refunded: '异议成立，订单已取消并退款', completed: '异议不成立，订单已完成' }

// 十六进制颜色校验：合法返回 #RRGGBB，否则返回空串（表示未自定义）
function normalizeHex(v) {
  const s = String(v || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s
  return ''
}

Page({
  data: {
    ready: false,
    role: '',
    permissions: [],
    // 首屏横幅动效降级：true 时卡片挂 fx-off，只停动画、静态描边保留
    fxOff: false,
    activeTab: 'overview',
    activeSubTab: 'groupChat',
    subTabs: {},
    tabs: [],
    stats: null,
    statsUpdatedAt: '',
    reports: [],
    posts: [],
    postStatus: '',
    postKeyword: '',
    selectedPostIds: [],
    contentType: 'notice',
    contentList: [],
    styleNames: BANNER_STYLE_NAMES,
    styleBg: BANNER_STYLE_BG,
    styleFg: BANNER_STYLE_FG,
    colorPickerShow: false,
    colorPickerField: '',
    colorPickerValue: '',
    colorPickerTitle: '选择颜色',
    contentFormTitle: '',
    contentFormGuide: '',
    items: [],
    // 区块折叠开关（默认收起，点「展开 ▼」显示内容）：校园卡页面/评分对象管理/找驾校/服务宫格/群聊列表/群聊类别/社团分类/管理员账号
    sectionCollapsed: { campusCard: true, market: true, drivingGuide: true, promoLanding: true, drivingPromo: true, drivingTags: true, reviewTargets: true, drivingSchools: true, services: true, gcGroups: true, gcCategories: true, clubCategories: true, admins: true },
    // 校园卡自定义页面列表，可维护多张（编辑跳 pages/banner-detail?scope=campusCard）
    campusCards: [],
    // 校园市场四分类页面（每类一张，编辑跳 pages/banner-detail?scope=market&category=<key>）
    marketCategories: [
      { key: 'rental', name: '租赁服务' },
      { key: 'digital', name: '校园数码' },
      { key: 'housekeeping', name: '校园家政' },
      { key: 'diypc', name: 'DIY电脑' }
    ],
    marketPages: [],
    // 找驾校内容管理（「物品」tab，校园卡页面下方）
    drivingSchools: [],
    drivingSchoolCampusOptions: ['广州校区', '佛山校区'],
    drivingSchoolLevelOptions: ['S', 'A', 'B'],
    // 评分对象治理（「物品」tab，找驾校下方）：软删可在「已删除」里恢复
    reviewTargets: [],
    reviewTargetCategory: '',
    reviewTargetState: '',
    reviewTargetKeyword: '',
    // 两级钻取：0 = 食堂/商圈/课程根列表，非 0 = 该根条目下的窗口/店铺
    reviewTargetParentId: 0,
    reviewTargetParentName: '',
    reviewTargetPage: 1,
    reviewTargetTotal: 0,
    reviewTargetHasMore: false,
    reviewTargetLoading: false,
    // 驾校运营位（「物品」tab 内联编辑，每类只有一条记录）
    promoForm: { title: '', sub: '', btnText: '', tagsText: '', image: '', status: 1 },
    promoUpdatedAtText: '',
    promoSaving: false,
    drivingTags: [],
    drivingTagInput: '',
    // false = 尚未保存过自定义配置，框里显示的是内置默认池
    drivingTagsSaved: false,
    drivingTagsUpdatedAtText: '',
    drivingTagsSaving: false,
    // 学车指南自定义页摘要（编辑跳 pages/banner-detail?scope=drivingGuide）
    drivingGuide: { title: '', status: true, updatedAtText: '' },
    // 校园圈学车落地页摘要（编辑跳 pages/banner-detail?scope=promoLanding）
    promoLanding: { title: '', status: true, updatedAtText: '' },
    services: [],
    serviceCategories: [],
    serviceCategoryNames: [],
    users: [],
    withdrawals: [],
    // 提现审核筛选：'' = 全部（含成功/失败/驳回），默认展示全部账单
    withdrawalStatus: '',
    riderVerifications: [],
    // 审核 tab：活动审核子页（普通用户发布的活动需审核通过后才公开）
    activityAudits: [],
    activityAuditStatus: '',
    activityAuditDetail: null,
    userKeyword: '',
    admins: [],
    roleLabels: ROLE_LABELS,
    rolePermissionText: ROLE_PERMISSION_TEXT,
    showAdminModal: false,
    adminQuery: '',
    adminRoleIndex: 0,
    adminRoleNames: CREATE_ROLE_NAMES,
    adminSaving: false,
    // 日志 tab：跑腿订单流程列表（xx 发布订单 → xx 接单 → 完成/取消）
    errandOrders: [],
    errandStatus: '',
    errandKeyword: '',
    errandPage: 1,
    errandHasMore: false,
    errandLoading: false,
    errandDetail: null,
    // 日志 tab 内部分段：跑腿订单流程 / 订阅消息发送流水 / 维修信息
    logScope: 'errand',
    subscribeLogs: [],
    subscribeLogStatus: '',
    subscribeLogKeyword: '',
    subscribeLogPage: 1,
    subscribeLogHasMore: false,
    subscribeLogLoading: false,
    subscribeQuota: [],
    subscribePendingTotal: 0,
    // 维修信息：用户提交的预约维修（含提交人资料）
    repairOrders: [],
    repairStatus: '',
    repairKeyword: '',
    repairPage: 1,
    repairHasMore: false,
    repairLoading: false,
    repairDetail: null,
    // 群聊管理 tab：建群申请审核 + 群聊上下架 + 群聊类别编辑
    groupChatApplies: [],
    groupChatApplyStatus: 'pending',
    groupChatGroups: [],
    gcCategories: [],
    chatCategoryNames: GC_CATEGORIES,
    joinModeLabels: JOIN_MODE_LABELS,
    campusOptions: CAMPUS_SELECT_OPTIONS,
    // 活动管理 tab：活动列表 + 关键词搜索
    activities: [],
    activityKeyword: '',
    // 活动详情弹窗：报名用户名单（仅管理员可见）
    activitySignupDetail: null,
    activitySignupKeyword: '',
    activitySignupLoading: false,
    // 社团管理 tab：分类（含各分类下社团明细）+ 展开状态
    clubCategories: [],
    clubCategoryNames: [],
    expandedClubCategory: -1,
    // 社团模块内的两个功能区：社团分类管理（现有页面）/ 社团审核（用户端提交的申请）
    clubAuditView: 'categories',
    clubApplies: [],
    clubApplyStatus: 'pending',
    clubAuditDetail: null,
    // 群聊模块内的两个功能区：群聊信息（群聊列表与类别维护，即原有页面）/ 群聊审核（用户端提交的建群申请）
    groupChatView: 'info',
    form: null,
    saving: false,
    showCertModal: false,
    certUserId: 0,
    certDraft: '',
    savingCert: false
  },

  // 表单「未保存修改」检查：在 setData 这一层拦截，整表赋值（form: {...} / form: null）
  // 视为打开或关闭表单并记录快照，局部更新（['form.x']）不动快照。
  // 放在这里而不是十几个 begin* 方法里逐个打点，避免新增表单时漏记。
  installFormSnapshot() {
    if (this._formSnapshotHooked) return
    this._formSnapshotHooked = true
    const originalSetData = this.setData.bind(this)
    this.setData = (patch, callback) => {
      if (patch && typeof patch === 'object' && patch.form !== undefined) {
        this._formSnapshot = patch.form ? JSON.stringify(patch.form) : null
      }
      return originalSetData(patch, callback)
    }
  },

  async onLoad() {
    this.installFormSnapshot()
    try {
      const access = await admin.me()
      // The server is authoritative for roles. Refresh the cached profile so
      // post actions reflect a role change without requiring another login.
      const app = getApp()
      const currentUser = app.globalData.userInfo || wx.getStorageSync('userInfo') || {}
      const userInfo = Object.assign({}, currentUser, { role: access.role || 'user' })
      app.globalData.userInfo = userInfo
      wx.setStorageSync('userInfo', userInfo)
      this.meId = Number(access.id || 0)
      const tabs = [
        { key: 'overview', name: '概览' },
        { key: 'reports', name: '举报' },
        { key: 'posts', name: '帖子' },
        { key: 'content', name: '配置' },
        { key: 'items', name: '物品' },
        { key: 'services', name: '服务' },
        { key: 'clubGroup', name: '群聊/社团' },
        { key: 'activities', name: '活动' },
        { key: 'userAdmin', name: '用户管理' },
        { key: 'review', name: '审核' },
        { key: 'logs', name: '日志' }
      ].filter((tab) => {
        const required = TAB_PERMISSIONS[tab.key]
        const perms = access.permissions || []
        // 数组权限=任一满足即可见（用于合并后的父级菜单）
        return Array.isArray(required) ? required.some((p) => this.can(perms, p)) : this.can(perms, required)
      })
      if (!tabs.length) throw new Error('无可用管理权限')
      // 计算每个合并父级菜单下当前角色可见的子页（子页按各自权限过滤）
      const perms = access.permissions || []
      const subTabs = {}
      Object.keys(SUB_TABS).forEach((parent) => {
        subTabs[parent] = SUB_TABS[parent].filter((sub) => this.can(perms, sub.perm))
      })
      const firstSubs = subTabs[tabs[0].key] || []
      this.setData({
        ready: true,
        role: access.role,
        permissions: perms,
        tabs,
        subTabs,
        activeTab: tabs[0].key,
        activeSubTab: firstSubs.length ? firstSubs[0].key : this.data.activeSubTab
      })
      this.loadCurrent()
      this.startStatsTimer()
    } catch (e) {
      wx.showModal({ title: '无法访问', content: '当前账号没有管理员权限或权限已变更。', showCancel: false, complete: () => wx.navigateBack() })
    }
  },

  onShow() {
    // 动效降级每次回到本页都同步：设置页刚关掉要立即生效，低端机判定结果不会变但成本极低（照首页写法）
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
    // 返回本页时重启轮询并立即刷新概览，保证数字尽量新
    if (this.data.ready && this.data.activeTab === 'overview') this.refreshStats(true)
    if (this.data.ready) this.startStatsTimer()
    // 从校园卡/学车指南/校园市场编辑器返回时刷新摘要（标题/发布状态/更新时间即时可见）
    if (this.data.ready && this.data.activeTab === 'items') { this.loadCampusCards(); this.loadMarketPages(); this.loadDrivingOps() }
  },

  onHide() { this.stopStatsTimer() },

  onUnload() { this.stopStatsTimer() },

  onPullDownRefresh() {
    runPullDownRefresh(this, this.loadCurrent)
  },

  startStatsTimer() {
    if (this._statsTimer) return
    this._statsTimer = setInterval(() => {
      const busy = this.data.form || this.data.showCertModal || this.data.showAdminModal
      if (this.data.ready && this.data.activeTab === 'overview' && !busy) this.refreshStats(true)
    }, STATS_POLL_MS)
  },

  stopStatsTimer() {
    if (this._statsTimer) { clearInterval(this._statsTimer); this._statsTimer = null }
  },

  can(permissions, permission) {
    return permissions.indexOf('*') >= 0 || permissions.indexOf(permission) >= 0
  },

  async loadCurrent(opts) {
    const silent = !!(opts && opts.silent)
    const tab = this.data.activeTab
    const seq = (this._loadSeq = (this._loadSeq || 0) + 1)
    try {
      if (tab === 'overview') await this.refreshStats(silent)
      if (tab === 'reports') await this.loadReports()
      if (tab === 'posts') await this.loadPosts()
      if (tab === 'content') await this.loadContent()
      if (tab === 'items') {
        this.setData({ items: (await admin.items()).list || [] })
        this.loadCampusCards()
        this.loadMarketPages()
        this.loadDrivingSchools()
        this.loadReviewTargets(1)
        this.loadDrivingOps()
      }
      if (tab === 'services') await this.loadServices()
      if (tab === 'clubGroup' && this.data.activeSubTab === 'groupChat') {
        // 「群聊审核」只取建群申请；「群聊信息」还要带出群聊列表与类别
        if (this.data.groupChatView === 'audit') await this.loadGroupChatApplies()
        else await this.loadGroupChatData()
      }
      if (tab === 'clubGroup' && this.data.activeSubTab === 'clubs') {
        if (this.data.clubAuditView === 'audit') await this.loadClubApplies()
        else await this.loadClubCategories()
      }
      if (tab === 'activities') await this.loadActivities()
      if (tab === 'userAdmin' && this.data.activeSubTab === 'users') await this.loadUsers()
      if (tab === 'userAdmin' && this.data.activeSubTab === 'admins') await this.loadAdmins()
      if (tab === 'review' && this.data.activeSubTab === 'activityAudit') await this.loadActivityAudits()
      if (tab === 'review' && this.data.activeSubTab === 'withdrawals') await this.loadWithdrawals()
      if (tab === 'review' && this.data.activeSubTab === 'riderVerifications') await this.loadRiderVerifications()
      if (tab === 'logs') {
        if (this.data.logScope === 'subscribe') await this.loadSubscribeLogs(1)
        else if (this.data.logScope === 'repair') await this.loadRepairOrders(1)
        else await this.loadErrandOrders(1)
      }
    } catch (e) {
      // 请求返回顺序可能与点击顺序不一致，过期请求失败不打扰用户
      if (seq !== this._loadSeq) return
      if (!silent) wx.showToast({ title: (e && e.message) || '加载失败，请下拉重试', icon: 'none' })
    }
  },

  async refreshStats(silent) {
    const seq = (this._statsSeq = (this._statsSeq || 0) + 1)
    try {
      const stats = await admin.stats()
      if (seq !== this._statsSeq) return
      const d = stats && stats.generatedAt ? new Date(stats.generatedAt) : new Date()
      const stamp = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
      if (stats && Array.isArray(stats.recentActions)) {
        stats.recentActions = stats.recentActions.map((row) => Object.assign({}, row, describeAudit(row)))
      }
      this.setData({ stats, statsUpdatedAt: stamp })
    } catch (e) {
      if (!silent) wx.showToast({ title: (e && e.message) || '统计数据加载失败', icon: 'none' })
    }
  },

  refreshStatsTap() { this.refreshStats(false) },

  switchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    // 进入合并父级菜单时，重置为其可见子页中的第一个
    const subs = this.data.subTabs[key] || []
    const patch = { activeTab: key, selectedPostIds: [], form: null }
    if (subs.length) patch.activeSubTab = subs[0].key
    this.setData(patch)
    this.loadCurrent()
  },

  // 区块折叠：点标题右侧「展开 ▼／收起 ▲」切换该区块内容显隐（各区块互不影响）
  toggleSection(e) {
    const key = e.currentTarget.dataset.key
    if (!key || !(key in this.data.sectionCollapsed)) return
    this.setData({ ['sectionCollapsed.' + key]: !this.data.sectionCollapsed[key] })
  },

  // 合并父级菜单（社团/群聊、用户管理、审核）内的子页面切换：点击切换入口即可在子页面之间直接切换，无需返回上级菜单
  switchSubTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeSubTab) return
    this.setData({ activeSubTab: key, form: null })
    this.loadCurrent()
  },

  async loadPosts() {
    const data = await admin.posts({ status: this.data.postStatus, keyword: this.data.postKeyword, page: 1, pageSize: 50 })
    // checked 标志驱动复选框勾选状态（WXML 不支持方法调用，不能在模板里做 indexOf 判断）
    const posts = (data.list || []).map((row) => Object.assign({}, row, { checked: false }))
    this.setData({ posts, selectedPostIds: [] })
  },

  async loadReports() {
    const data = await admin.reports({ page: 1, pageSize: 50 })
    this.setData({ reports: data.list || [] })
  },

  async updateReport(e) {
    const id = Number(e.currentTarget.dataset.id)
    const status = String(e.currentTarget.dataset.status || '')
    const labels = { processing: '受理举报', resolved: '解决举报', rejected: '驳回举报' }
    if (!id || !labels[status]) return
    if (!await this.confirm(labels[status], '确认更新此举报的处理状态吗？')) return
    try {
      await admin.updateReport(id, status)
      wx.showToast({ title: '处理状态已更新', icon: 'success' })
      this.loadReports()
    } catch (err) {}
  },

  onPostKeyword(e) { this.setData({ postKeyword: e.detail.value }) },
  searchPosts() { this.loadPosts() },
  choosePostStatus(e) {
    const value = e.currentTarget.dataset.status
    this.setData({ postStatus: value === '' ? '' : Number(value) })
    this.loadPosts()
  },
  selectPosts(e) {
    const ids = (e.detail.value || []).map(Number)
    // checkbox-group 只返回选中项，这里同步每行的 checked 标志，保持勾选框与已选列表一致
    const posts = this.data.posts.map((row) => Object.assign({}, row, { checked: ids.indexOf(Number(row.id)) >= 0 }))
    this.setData({ selectedPostIds: ids, posts })
  },

  confirm(title, content) {
    return new Promise((resolve) => wx.showModal({ title, content, confirmColor: '#e64340', success: (res) => resolve(res.confirm) }))
  },

  async doPostAction(e) {
    const id = Number(e.currentTarget.dataset.id); const action = e.currentTarget.dataset.action
    const labels = { approve: '审核通过', delete: '删除', hide: '隐藏', pin: '置顶', unpin: '取消置顶' }
    if (!await this.confirm(labels[action] + '帖子', '该操作将立即影响用户可见内容。')) return
    try { await admin.postAction(id, action); wx.showToast({ title: '操作成功', icon: 'success' }); this.loadPosts() } catch (err) {}
  },

  batchPostAction() {
    const ids = this.data.selectedPostIds
    if (!ids.length) return wx.showToast({ title: '请先选择帖子', icon: 'none' })
    wx.showActionSheet({ itemList: ['审核通过', '隐藏', '删除', '置顶', '取消置顶'], success: async (res) => {
      const actions = ['approve', 'hide', 'delete', 'pin', 'unpin']; const action = actions[res.tapIndex]
      if (!await this.confirm('批量' + ['审核通过', '隐藏', '删除', '置顶', '取消置顶'][res.tapIndex], `将处理 ${ids.length} 条帖子。`)) return
      try { const result = await admin.batchPostAction(ids, action); wx.showToast({ title: `已处理${result.affected || 0}条`, icon: 'success' }); this.loadPosts() } catch (err) {}
    } })
  },

  beginPostEdit(e) {
    const post = this.data.posts.find((item) => Number(item.id) === Number(e.currentTarget.dataset.id))
    if (!post) return
    this.setData({ form: { kind: 'post', id: post.id, title: post.title || '', content: post.content || '', category: post.category || '' } })
  },

  chooseContentType(e) { this.setData({ contentType: e.currentTarget.dataset.type }); this.loadContent() },

  // 页面横幅编辑：跳转到 banner-detail 页的编辑模式（scope 区分两条独立横幅）
  goBannerEditor(e) {
    const scope = e.currentTarget.dataset.scope === 'post' ? 'post' : 'message'
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=' + scope })
  },

  async loadContent() {
    const data = await admin.content(this.data.contentType)
    const list = (data.list || []).map((row) => {
      if (row.type !== 'tag') return row
      const meta = this.parseContentMeta('tag', row.body)
      return Object.assign({}, row, { tagBg: meta.bgColor, tagFg: meta.textColor })
    })
    this.setData({ contentList: list })
  },
  // 轮播/公告的 body 存 JSON，表单里拆成结构化字段；分类/标签仍用纯文本
  emptyContentMeta(type) {
    if (type === 'banner') return { image: '', subtitle: '', tag: '', link: '', accent: '' }
    if (type === 'notice') return { tailText: '', tailImage: '', linkText: '', linkUrl: '', bgColor: '', textColor: '' }
    if (type === 'publish_banner') return { style: 'red', styleIndex: 0, icon: '', bgColor: '', textColor: '', link: '', linkText: '', detailTitle: '', detailContent: '' }
    if (type === 'tag') return { text: '', bgColor: '', textColor: '' }
    return null
  },
  parseContentMeta(type, body) {
    let meta = {}
    try { meta = JSON.parse(body) || {} } catch (e) {}
    if (type === 'banner') return { image: meta.image || '', subtitle: meta.subtitle || '', tag: meta.tag || '', link: meta.link || '', accent: normalizeHex(meta.accent) }
    if (type === 'notice') return { tailText: meta.tailText || '', tailImage: meta.tailImage || '', linkText: meta.linkText || '', linkUrl: meta.linkUrl || '', bgColor: normalizeHex(meta.bgColor), textColor: normalizeHex(meta.textColor) }
    if (type === 'publish_banner') {
      const styleIndex = Math.max(0, BANNER_STYLE_VALUES.indexOf(meta.style || 'red'))
      return { style: BANNER_STYLE_VALUES[styleIndex], styleIndex, icon: meta.icon || '', bgColor: normalizeHex(meta.bgColor), textColor: normalizeHex(meta.textColor), link: meta.link || '', linkText: meta.linkText || '', detailTitle: meta.detailTitle || '', detailContent: meta.detailContent || '' }
    }
    // 标签：新格式 body 为 JSON { text, bgColor, textColor }；旧格式 body 为纯文本描述，需兼容回退
    if (type === 'tag') {
      if (meta && typeof meta === 'object' && (meta.text !== undefined || meta.bgColor || meta.textColor)) {
        return { text: String(meta.text || ''), bgColor: normalizeHex(meta.bgColor), textColor: normalizeHex(meta.textColor) }
      }
      return { text: String(body || ''), bgColor: '', textColor: '' }
    }
    return null
  },
  onFormStyleChange(e) {
    const index = Number(e.detail.value) || 0
    this.setData({ 'form.meta.styleIndex': index, 'form.meta.style': BANNER_STYLE_VALUES[index] })
  },
  // ===== 内容配置弹窗颜色选择：背景颜色 / 文字颜色 / 轮播主题色 / 社团分类主题色 =====
  openContentColorPicker(e) {
    const allowed = ['textColor', 'accent', 'bgColor', 'color']
    const field = allowed.indexOf(e.currentTarget.dataset.field) >= 0 ? e.currentTarget.dataset.field : 'bgColor'
    const titles = { bgColor: '选择背景颜色', textColor: '选择文字颜色', accent: '选择主题色', color: '选择主题色' }
    this.setData({
      colorPickerField: field,
      colorPickerValue: (this.data.form.meta || {})[field] || '',
      colorPickerTitle: titles[field],
      colorPickerShow: true
    })
  },
  onColorPickerClose() { this.setData({ colorPickerShow: false }) },
  onColorPickerConfirm(e) {
    const hex = normalizeHex(e.detail && e.detail.hex)
    const field = this.data.colorPickerField
    if (field && this.data.form) this.setData({ ['form.meta.' + field]: hex, colorPickerShow: false })
    else this.setData({ colorPickerShow: false })
  },
  beginContentCreate() {
    const type = this.data.contentType
    const info = CONTENT_FORM_META[type] || { title: '内容', guide: '' }
    this.setData({ contentFormTitle: info.title, contentFormGuide: info.guide, form: Object.assign({ kind: 'content', type, title: '', body: '', status: 1, sortOrder: 0 }, { meta: this.emptyContentMeta(type) }) })
  },
  beginContentEdit(e) {
    const item = this.data.contentList.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!item) return
    const info = CONTENT_FORM_META[item.type] || { title: '内容', guide: '' }
    const meta = this.parseContentMeta(item.type, item.body)
    // 标签的描述文字存在 meta.text 中（旧数据为纯文本 body，已在 parseContentMeta 兼容）
    const body = item.type === 'tag' ? (meta.text || '') : (item.body || '')
    this.setData({ contentFormTitle: info.title, contentFormGuide: info.guide, form: Object.assign({ kind: 'content' }, item, { body, meta }) })
  },
  chooseFormImage(e) {
    const key = e.currentTarget.dataset.key
    if (!key || !this.data.form) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages([file.tempFilePath]).then((urls) => {
          wx.hideLoading()
          const url = (urls || [])[0]
          if (!url || !/^https:\/\//.test(url)) throw new Error('upload failed')
          this.setData({ ['form.meta.' + key]: url })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        })
      }
    })
  },
  async deleteContent(e) { const id = Number(e.currentTarget.dataset.id); if (!await this.confirm('删除内容', '删除后无法恢复。')) return; try { await admin.deleteContent(id); this.loadContent() } catch (err) {} },

  beginItemCreate() { this.setData({ form: { kind: 'item', name: '', description: '', coverUrl: '', price: '', stock: 0, status: 1 } }) },
  beginItemEdit(e) { const item = this.data.items.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id)); if (item) this.setData({ form: Object.assign({ kind: 'item' }, item) }) },
  async toggleItem(e) { const item = this.data.items.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id)); if (!item) return; const status = item.status ? 0 : 1; if (!await this.confirm(status ? '上架物品' : '下架物品', `确定${status ? '上架' : '下架'}“${item.name}”吗？`)) return; try { await admin.updateItem(item.id, { status }); this.loadCurrent() } catch (err) {} },

  // ===== 校园卡自定义页面（「物品」tab 列表；编辑器复用公告详情页表单 pages/banner-detail） =====
  async loadCampusCards() {
    try {
      const list = await admin.campusCardPages()
      this.setData({
        campusCards: (list || []).map((page) => Object.assign({}, page, {
          updatedAtText: page.updatedAt ? String(page.updatedAt).slice(0, 10) : ''
        }))
      })
    } catch (e) { /* 读取失败保留当前列表，不阻塞物品列表 */ }
  },
  findCampusCard(id) {
    return this.data.campusCards.find((page) => Number(page.id) === Number(id))
  },
  beginCampusCardCreate() {
    // 不带 id 即新建，编辑器（pages/banner-detail）据此直接进空表单编辑态
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=campusCard' })
  },
  openCampusCardEditor(e) {
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=campusCard&edit=1&id=' + e.currentTarget.dataset.id })
  },
  // 上下架需回传整张页面内容：保存接口按 title/content/images 全量校验
  async toggleCampusCard(e) {
    const page = this.findCampusCard(e.currentTarget.dataset.id)
    if (!page) return
    const status = page.status ? 0 : 1
    if (!await this.confirm(status ? '发布页面' : '下线页面', `确定${status ? '发布' : '下线'}“${page.title}”吗？`)) return
    try {
      await admin.updateCampusCardPage(page.id, { title: page.title, content: page.content, images: page.images, status })
      this.loadCampusCards()
    } catch (err) {}
  },
  async deleteCampusCard(e) {
    const page = this.findCampusCard(e.currentTarget.dataset.id)
    if (!page) return
    if (!await this.confirm('删除校园卡页面', `删除“${page.title}”后无法恢复。`)) return
    try { await admin.deleteCampusCardPage(page.id); this.loadCampusCards() } catch (err) {}
  },

  // ===== 校园市场四分类页面（「物品」tab；每类一张，编辑器复用 pages/banner-detail?scope=market） =====
  // 四行固定渲染：单个分类读取失败（如服务端未更新到新接口）不影响其它行显示
  async loadMarketPages() {
    const rows = this.data.marketCategories.map((item) => ({
      category: item.key,
      name: item.name,
      page: null,
      updatedAtText: ''
    }))
    this.setData({ marketPages: rows })
    await Promise.all(this.data.marketCategories.map((item, index) =>
      admin.marketPage(item.key).then((page) => {
        this.setData({
          ['marketPages[' + index + '].page']: page || null,
          ['marketPages[' + index + '].updatedAtText']: page && page.updatedAt ? String(page.updatedAt).slice(0, 10) : ''
        })
      }).catch(() => { /* 单个分类读取失败：保留「尚未创建」占位 */ })
    ))
  },
  openMarketEditor(e) {
    wx.navigateTo({
      url: '/pages/banner-detail/index?scope=market&category=' + e.currentTarget.dataset.category + '&edit=1',
      fail: () => wx.showToast({ title: '打开编辑器失败，请稍后重试', icon: 'none' })
    })
  },

  // ===== 找驾校内容管理（「物品」tab；字段与前台卡片一一对应） =====
  async loadDrivingSchools() {
    try { this.setData({ drivingSchools: (await admin.drivingSchools()).list || [] }) } catch (e) { /* 读取失败保留旧列表 */ }
  },
  // 表单/列表行 → 服务端提交体（tags 支持数组或逗号分隔文本）
  buildSchoolPayload(form) {
    const tags = Array.isArray(form.tags)
      ? form.tags
      : String(form.tags || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
    return {
      name: String(form.name || '').trim(),
      campus: form.campus || this.data.drivingSchoolCampusOptions[0],
      region: String(form.region || '').trim(),
      address: String(form.address || '').trim(),
      phone: String(form.phone || '').trim(),
      carTypes: String(form.carTypes || '').trim(),
      price: String(form.price || '').trim(),
      intro: String(form.intro || '').trim(),
      passRate: Number(form.passRate) || 0,
      level: form.level || 'A',
      tags,
      distanceKm: Number(form.distanceKm) || 0,
      cover: String(form.cover || '').trim(),
      contactQr: String(form.contactQr || '').trim(),
      contactName: String(form.contactName || '').trim(),
      // 坐标由「在地图上选点」得到（wx.chooseLocation）；0 = 未选点，用户端不显示地图入口。
      // 必须回传，否则编辑任一字段都会把已有坐标清零
      lat: Number(form.lat) || 0,
      lng: Number(form.lng) || 0,
      images: (form.images || []).slice(0, 9),
      detail: String(form.detail || '').trim(),
      sortOrder: Number(form.sortOrder) || 0,
      status: form.status === false || Number(form.status) === 0 ? 0 : 1
    }
  },
  beginDrivingSchoolCreate() {
    const campus = this.data.drivingSchoolCampusOptions[0]
    this.setData({
      form: {
        kind: 'drivingSchool', name: '', campus, campusIndex: 0, region: '', address: '', phone: '',
        carTypes: 'C1 C2', price: '', intro: '', passRate: '', level: 'A', levelIndex: 1,
        tags: '', distanceKm: '', cover: '', images: [], detail: '', sortOrder: 0, status: 1, lat: 0, lng: 0, contactQr: '', contactName: ''
      }
    })
  },
  beginDrivingSchoolEdit(e) {
    const row = this.data.drivingSchools.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id))
    if (!row) return
    this.setData({
      form: Object.assign({ kind: 'drivingSchool' }, row, {
        campusIndex: Math.max(0, this.data.drivingSchoolCampusOptions.indexOf(row.campus)),
        levelIndex: Math.max(0, this.data.drivingSchoolLevelOptions.indexOf(row.level)),
        tags: (row.tags || []).join('，'),
        images: (row.images || []).slice(),
        lat: Number(row.latitude) || 0,
        lng: Number(row.longitude) || 0,
        contactQr: row.contactQr || '',
        contactName: row.contactName || '',
        passRate: String(row.passRate || ''),
        distanceKm: row.distanceKm ? String(row.distanceKm) : '',
        status: !!row.status
      })
    })
  },
  onDrivingSchoolCampusChange(e) {
    const idx = Number(e.detail.value) || 0
    const campus = this.data.drivingSchoolCampusOptions[idx]
    if (!campus) return
    this.setData({ 'form.campusIndex': idx, 'form.campus': campus })
  },
  onDrivingSchoolLevelChange(e) {
    const idx = Number(e.detail.value) || 0
    const level = this.data.drivingSchoolLevelOptions[idx]
    if (!level) return
    this.setData({ 'form.levelIndex': idx, 'form.level': level })
  },
  chooseSchoolCover() {
    if (!this.data.form) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages([file.tempFilePath]).then((urls) => {
          wx.hideLoading()
          const url = (urls || [])[0]
          if (!url || !/^https:\/\//.test(url)) throw new Error('upload failed')
          this.setData({ 'form.cover': url })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '封面上传失败，请重试', icon: 'none' })
        })
      }
    })
  },
  clearSchoolCover() { this.setData({ 'form.cover': '' }) },
  // 咨询二维码：单图上传，与封面同一套 wechat.uploadImages 通道
  chooseSchoolQr() {
    if (!this.data.form) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['original'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages([file.tempFilePath]).then((urls) => {
          wx.hideLoading()
          const url = (urls || [])[0]
          if (!url || !/^https:\/\//.test(url)) throw new Error('upload failed')
          this.setData({ 'form.contactQr': url })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '二维码上传失败，请重试', icon: 'none' })
        })
      }
    })
  },
  clearSchoolQr() { this.setData({ 'form.contactQr': '' }) },
  // 训练场坐标：手动选点。高德对「公司全称」类地址的地理编码只到区县级（会钉到市中心），
  // POI 搜索又常命中别家驾校，所以这里不给自动解析，必须由管理员在地图上确认一次
  chooseSchoolLocation() {
    if (!this.data.form) return
    wx.chooseLocation({
      success: (res) => {
        const lat = Number(res.latitude)
        const lng = Number(res.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) {
          wx.showToast({ title: '未取到坐标，请重试', icon: 'none' })
          return
        }
        // 库里是 DECIMAL(10,6)，先按 6 位小数取整，避免界面显示一长串而落库被截断
        const round = (n) => Math.round(n * 1e6) / 1e6
        this.setData({ 'form.lat': round(lat), 'form.lng': round(lng) })
        // 选点框里的名称往往比「训练场地址」更准，顺手提示管理员可以直接采用
        const picked = String(res.name || res.address || '').trim()
        if (picked && !String(this.data.form.address || '').trim()) {
          this.setData({ 'form.address': picked })
        }
        wx.showToast({ title: '已选点，保存后生效', icon: 'none' })
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (msg.indexOf('cancel') >= 0) return
        wx.showToast({ title: '打开地图失败，请检查定位权限', icon: 'none' })
      }
    })
  },
  clearSchoolLocation() { this.setData({ 'form.lat': 0, 'form.lng': 0 }) },
  addSchoolImage() {
    const form = this.data.form
    if (!form) return
    const remain = 9 - (form.images || []).length
    if (remain <= 0) { wx.showToast({ title: '最多上传 9 张场地图片', icon: 'none' }); return }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
        if (!paths.length) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages(paths).then((urls) => {
          wx.hideLoading()
          const valid = (urls || []).filter((url) => /^https:\/\//.test(url))
          if (!valid.length) throw new Error('upload failed')
          this.setData({ 'form.images': (form.images || []).concat(valid).slice(0, 9) })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        })
      }
    })
  },
  removeSchoolImage(e) {
    const images = (this.data.form.images || []).slice()
    images.splice(Number(e.currentTarget.dataset.index), 1)
    this.setData({ 'form.images': images })
  },
  async toggleDrivingSchool(e) {
    const row = this.data.drivingSchools.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id))
    if (!row) return
    const next = row.status ? 0 : 1
    if (!await this.confirm(next ? '启用驾校' : '停用驾校', `确定${next ? '启用' : '停用'}“${row.name}”吗？${next ? '启用后立即在用户端展示。' : '停用后用户端不再展示。'}`)) return
    try {
      await admin.updateDrivingSchool(row.id, this.buildSchoolPayload(Object.assign({}, row, { status: next })))
      this.loadDrivingSchools()
    } catch (err) {}
  },
  async deleteDrivingSchool(e) {
    const row = this.data.drivingSchools.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id))
    if (!row) return
    if (!await this.confirm('删除驾校', `确定删除“${row.name}”吗？该操作不可恢复。`)) return
    try {
      await admin.deleteDrivingSchool(row.id)
      wx.showToast({ title: '已删除', icon: 'success' })
      this.loadDrivingSchools()
    } catch (err) {}
  },
  // ===== 驾校运营位（「物品」tab；横幅 / 筛选标签池 / 学车指南自定义页 / 校园圈学车落地页） =====
  async loadDrivingOps() {
    try {
      // 用 allSettled 而不是 all：Promise.all 只要一个接口 reject（如某个路由还没部署返回 404），
      // 整组结果全丢，后台四块内容一起变空白且没有任何提示。
      const settled = await Promise.allSettled([
        admin.drivingPromo(),
        admin.drivingServiceTags(),
        admin.drivingGuidePage(),
        admin.promoLandingPage()
      ])
      const [promo, tags, guide, promoLanding] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null))
      const patch = {}
      if (promo) {
        patch.promoForm = {
          title: promo.title || '',
          sub: promo.sub || '',
          btnText: promo.btnText || '',
          tagsText: (promo.tags || []).join('、'),
          image: promo.image || '',
          status: promo.status ? 1 : 0
        }
        patch.promoUpdatedAtText = promo.updatedAt ? String(promo.updatedAt).slice(0, 10) : ''
      }
      // 与前台 loadTagPool 同口径：未配置/已下线 → 内置池；已保存（哪怕是空）→ 以配置为准。
      // 请求本身失败时不动这块 —— null 不等于「未配置」，误填内置池会让保存覆盖掉真配置
      if (settled[1].status === 'fulfilled') {
        const savedTags = tags && tags.status && Array.isArray(tags.tags) ? tags.tags : null
        const effectiveTags = savedTags || drivingSchool.SERVICE_TAGS
        patch.drivingTags = effectiveTags.map((name) => ({ name, removing: false }))
        patch.drivingTagInput = ''
        patch.drivingTagsSaved = !!savedTags
        patch.drivingTagsUpdatedAtText = tags && tags.updatedAt ? String(tags.updatedAt).slice(0, 10) : ''
      }
      patch.drivingGuide = {
        title: (guide && guide.title) || '',
        status: guide ? !!guide.status : true,
        updatedAtText: guide && guide.updatedAt ? String(guide.updatedAt).slice(0, 10) : ''
      }
      // 校园圈学车落地页（找驾校横幅跳转目标；与学车指南相互独立）
      patch.promoLanding = {
        title: (promoLanding && promoLanding.title) || '',
        status: promoLanding ? !!promoLanding.status : true,
        updatedAtText: promoLanding && promoLanding.updatedAt ? String(promoLanding.updatedAt).slice(0, 10) : ''
      }
      this.setData(patch)
    } catch (e) { /* 读取失败保留当前表单，不阻塞其他区块 */ }
  },
  onPromoInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ ['promoForm.' + key]: e.detail.value })
  },
  onPromoStatusSwitch(e) { this.setData({ 'promoForm.status': e.detail.value ? 1 : 0 }) },
  choosePromoImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages([file.tempFilePath]).then((urls) => {
          wx.hideLoading()
          const url = (urls || [])[0]
          if (!url || !/^https:\/\//.test(url)) throw new Error('upload failed')
          this.setData({ 'promoForm.image': url })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '背景图上传失败，请重试', icon: 'none' })
        })
      }
    })
  },
  clearPromoImage() { this.setData({ 'promoForm.image': '' }) },
  async saveDrivingPromo() {
    const form = this.data.promoForm
    if (this.data.promoSaving) return
    if (!String(form.title || '').trim()) { wx.showToast({ title: '请填写主标题', icon: 'none' }); return }
    const tags = String(form.tagsText || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
    this.setData({ promoSaving: true })
    try {
      await admin.saveDrivingPromo({
        title: String(form.title).trim(),
        sub: String(form.sub || '').trim(),
        btnText: String(form.btnText || '').trim(),
        tags,
        image: form.image || '',
        status: form.status ? 1 : 0
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.loadDrivingOps()
    } catch (e) { /* 服务端校验信息已由 request 弹出 */ } finally {
      this.setData({ promoSaving: false })
    }
  },
  onDrivingTagInput(e) { this.setData({ drivingTagInput: e.detail.value }) },
  // 一次可粘贴多个（、或逗号分隔）；重复项静默跳过，超限与超长明确提示，口径与服务端一致
  addDrivingTags() {
    const parts = String(this.data.drivingTagInput || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) { wx.showToast({ title: '请先输入标签', icon: 'none' }); return }
    const list = this.data.drivingTags.slice()
    const exist = list.map((item) => item.name)
    for (const name of parts) {
      if (name.length > 8) { wx.showToast({ title: '「' + name + '」超过 8 字', icon: 'none' }); return }
      if (exist.indexOf(name) >= 0) continue
      if (list.length >= 12) { wx.showToast({ title: '最多 12 个标签', icon: 'none' }); return }
      list.push({ name, removing: false })
      exist.push(name)
    }
    this.setData({ drivingTags: list, drivingTagInput: '' })
  },
  // 两段式删除：先播「缩成圆点」动画，动画结束再真正移出数组。
  // transform 不影响布局，所以动画里同时收 max-width/margin，后面的标签才会平滑补位、容器高度同步收缩
  removeDrivingTag(e) {
    const index = Number(e.currentTarget.dataset.index)
    const tag = this.data.drivingTags[index]
    if (!tag || tag.removing) return
    this.setData({ ['drivingTags[' + index + '].removing']: true })
    setTimeout(() => {
      const list = this.data.drivingTags.filter((item) => item.name !== tag.name)
      this.setData({ drivingTags: list })
    }, 240)
  },
  async saveDrivingTags() {
    if (this.data.drivingTagsSaving) return
    const tags = this.data.drivingTags.filter((item) => !item.removing).map((item) => item.name)
    this.setData({ drivingTagsSaving: true })
    try {
      await admin.saveDrivingServiceTags({ tags, status: 1 })
      wx.showToast({ title: tags.length ? '已保存 ' + tags.length + ' 个标签' : '已清空标签', icon: 'none' })
      this.loadDrivingOps()
    } catch (e) {} finally {
      this.setData({ drivingTagsSaving: false })
    }
  },
  openDrivingGuideEditor() {
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=drivingGuide&edit=1' })
  },
  // 校园圈学车落地页（找驾校横幅跳转目标）：与学车指南分开的独立编辑入口
  openPromoLandingEditor() {
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=promoLanding&edit=1' })
  },

  // ===== 评分对象治理（「物品」tab；删除为软删，用户端立即不可见，可在「已删除」里恢复） =====
  async loadReviewTargets(page) {
    if (this.data.reviewTargetLoading) return
    const targetPage = Math.max(1, Number(page) || 1)
    this.setData({ reviewTargetLoading: true })
    try {
      const data = await admin.reviewTargets({
        category: this.data.reviewTargetCategory,
        state: this.data.reviewTargetState,
        keyword: this.data.reviewTargetKeyword,
        parentId: this.data.reviewTargetParentId,
        page: targetPage,
        pageSize: 20
      })
      const list = (data.list || []).map((row) => {
        const scope = []
        if (!row.parentId) scope.push(REVIEW_CATEGORY_TEXT[row.category] || row.category)
        if (row.campus) scope.push(row.campus)
        if (row.floor) scope.push(row.floor)
        if (row.grade) scope.push(row.grade)
        return Object.assign({}, row, {
          scopeText: scope.join(' · '),
          statText: `${row.ratingCount ? row.ratingAvg : '暂无'} 分 · ${row.ratingCount} 人评分 · ${row.commentCount} 条评价`,
          ownerText: '创建人：' + (row.createdByName || '未知') + (row.createdAt ? ' · ' + row.createdAt.slice(0, 10) : ''),
          // 根级食堂/商圈可下钻看子条目，子条目数直接标在行上
          childText: row.parentId || row.category === 'course'
            ? ''
            : `${row.childCount} 个${row.category === 'canteen' ? '窗口' : '店铺'}`,
          // 只有食堂/商圈的根级条目才带子对象，删除提示要说明连带范围
          childTip: row.category === 'course' || row.parentId ? '' : '，其下的窗口/店铺会一并删除'
        })
      })
      this.setData({
        reviewTargets: targetPage > 1 ? this.data.reviewTargets.concat(list) : list,
        reviewTargetPage: targetPage,
        reviewTargetTotal: Number(data.total || 0),
        reviewTargetHasMore: !!data.hasMore
      })
    } catch (e) { /* 读取失败保留旧列表 */ } finally {
      this.setData({ reviewTargetLoading: false })
    }
  },
  // 点根条目行进子列表；课程与子条目本身没有下一级，直接忽略
  openReviewTargetChildren(e) {
    const dataset = e.currentTarget.dataset
    if (dataset.parent || dataset.category === 'course') return
    this.setData({
      reviewTargetParentId: Number(dataset.id) || 0,
      reviewTargetParentName: dataset.name || '',
      reviewTargetKeyword: ''
    })
    this.loadReviewTargets(1)
  },
  backReviewTargets() {
    this.setData({ reviewTargetParentId: 0, reviewTargetParentName: '' })
    this.loadReviewTargets(1)
  },
  chooseReviewTargetCategory(e) {
    this.setData({ reviewTargetCategory: String(e.currentTarget.dataset.cat || '') })
    this.loadReviewTargets(1)
  },
  chooseReviewTargetState(e) {
    this.setData({ reviewTargetState: String(e.currentTarget.dataset.state || '') })
    this.loadReviewTargets(1)
  },
  onReviewTargetKeyword(e) { this.setData({ reviewTargetKeyword: e.detail.value }) },
  searchReviewTargets() { this.loadReviewTargets(1) },
  loadMoreReviewTargets() { if (this.data.reviewTargetHasMore) this.loadReviewTargets(this.data.reviewTargetPage + 1) },
  async deleteReviewTarget(e) {
    const row = this.data.reviewTargets.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id))
    if (!row) return
    if (!await this.confirm('删除评分对象', `删除“${row.name}”后用户端立即不可见${row.childTip}，可在「已删除」里恢复。`)) return
    try {
      const data = await admin.deleteReviewTarget(row.id)
      wx.showToast({ title: data && data.affected > 1 ? `已删除 ${data.affected} 条` : '已删除', icon: 'none' })
      this.loadReviewTargets(1)
    } catch (err) {}
  },
  async restoreReviewTarget(e) {
    const row = this.data.reviewTargets.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id))
    if (!row) return
    try { await admin.restoreReviewTarget(row.id); wx.showToast({ title: '已恢复', icon: 'success' }); this.loadReviewTargets(1) } catch (err) {}
  },

  async loadServices() { const data = await admin.services(); const categories = data.categories || []; this.setData({ services: data.list || [], serviceCategories: categories, serviceCategoryNames: categories.map((c) => c.name) }) },
  beginServiceCreate() { const cats = this.data.serviceCategories; if (!cats.length) { wx.showToast({ title: '请先在配置里添加服务分类', icon: 'none' }); return } this.setData({ form: { kind: 'service', categoryIndex: 0, categoryId: cats[0].id, name: '', icon: '', iconPath: '', badge: '', link: '', miniAppId: '', sortOrder: 0, status: 1 } }) },
  beginServiceEdit(e) { const row = this.data.services.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id)); if (!row) return; const idx = this.data.serviceCategories.findIndex((c) => Number(c.id) === Number(row.categoryId)); this.setData({ form: Object.assign({ kind: 'service', categoryIndex: idx < 0 ? 0 : idx }, row) }) },
  onServiceCategoryChange(e) { const idx = Number(e.detail.value); const cat = this.data.serviceCategories[idx]; if (!cat) return; const form = Object.assign({}, this.data.form, { categoryIndex: idx, categoryId: cat.id }); this.setData({ form }) },
  async toggleService(e) { const row = this.data.services.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id)); if (!row) return; const status = row.status ? 0 : 1; if (!await this.confirm(status ? '上架服务' : '下架服务', `确定${status ? '上架' : '下架'}“${row.name}”吗？`)) return; try { await admin.updateService(row.id, { status }); this.loadServices() } catch (err) {} },
  async deleteService(e) { const row = this.data.services.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id)); if (!row) return; if (!await this.confirm('删除服务', `确定删除服务“${row.name}”吗？该操作不可恢复。`)) return; try { await admin.deleteService(row.id); wx.showToast({ title: '已删除', icon: 'success' }); this.loadServices() } catch (err) {} },

  onUserKeyword(e) { this.setData({ userKeyword: e.detail.value }) },
  async loadUsers() { const data = await admin.users({ keyword: this.data.userKeyword, page: 1, pageSize: 50 }); this.setData({ users: data.list || [] }) },
  searchUsers() { this.loadUsers() },
  async loadWithdrawals() {
    const data = await admin.withdrawals({ page: 1, pageSize: 50, status: this.data.withdrawalStatus })
    const list = (data.list || []).map((row) => {
      // last_error 存的是「结论｜处置指引」，列表只显示结论，完整指引在失败弹窗里看
      const raw = String(row.lastError || '')
      return { ...row, lastErrorBrief: raw ? raw.split('｜')[0] : '', statusText: WITHDRAWAL_STATUS_TEXT[row.status] || row.status }
    })
    this.setData({ withdrawals: list })
  },
  chooseWithdrawalStatus(e) {
    this.setData({ withdrawalStatus: String(e.currentTarget.dataset.status || '') })
    this.loadWithdrawals()
  },
  async loadRiderVerifications() { const data = await admin.riderVerifications({ page: 1, pageSize: 50 }); this.setData({ riderVerifications: data.list || [] }) },

  // ===== 活动审核子页 =====
  chooseActivityAuditStatus(e) {
    const value = e.currentTarget.dataset.status
    this.setData({ activityAuditStatus: value === '' ? '' : String(value) })
    this.loadActivityAudits()
  },

  async loadActivityAudits() {
    const data = await admin.activityAudits({ page: 1, pageSize: 50, status: this.data.activityAuditStatus })
    const list = (data.list || []).map((row) => Object.assign({}, row, {
      auditStatusText: ACTIVITY_AUDIT_STATUS_TEXT[row.auditStatus] || row.auditStatus || '已通过',
      badgeText: ACTIVITY_BADGE_TEXT[row.badge] || '',
      signupImages: Array.isArray(row.signupImages) ? row.signupImages : [],
      createdAtText: fmtDateTime(row.createdAt),
      auditTimeText: fmtDateTime(row.auditTime)
    }))
    this.setData({ activityAudits: list, activityAuditDetail: null })
  },

  // 查看活动详情（弹层）
  viewActivityAudit(e) {
    const id = Number(e.currentTarget.dataset.id)
    const item = this.data.activityAudits.find((row) => Number(row.id) === id)
    if (!item) return
    this.setData({ activityAuditDetail: item })
  },
  closeActivityAuditDetail() { this.setData({ activityAuditDetail: null }) },

  // 通过：确认后直接过审；驳回：打开意见表单（必填）
  async approveActivityAudit(e) {
    const id = Number(e.currentTarget.dataset.id)
    const item = this.data.activityAudits.find((row) => Number(row.id) === id)
      || (this.data.activityAuditDetail && this.data.activityAuditDetail.id === id ? this.data.activityAuditDetail : null)
    if (!item) return
    if (!await this.confirm('通过活动审核', `通过后「${item.title}」将对全校用户公开可见。`)) return
    try {
      await admin.auditActivity(id, 'approve')
      wx.showToast({ title: '已通过并发布', icon: 'success' })
      this.setData({ activityAuditDetail: null })
      this.loadActivityAudits()
    } catch (err) {}
  },

  rejectActivityAudit(e) {
    const id = Number(e.currentTarget.dataset.id)
    const item = this.data.activityAudits.find((row) => Number(row.id) === id)
      || (this.data.activityAuditDetail && this.data.activityAuditDetail.id === id ? this.data.activityAuditDetail : null)
    if (!item) return
    this.setData({ form: { kind: 'activityAudit', id, action: 'reject', activityTitle: item.title, reviewNote: '' }, activityAuditDetail: null })
  },
  async reviewRiderVerification(e) {
    const id = Number(e.currentTarget.dataset.id)
    const action = e.currentTarget.dataset.action
    const label = action === 'approve' ? '通过认证' : '驳回认证'
    if (!await this.confirm(label, '该操作将立即影响用户的接单权限。')) return
    try {
      await admin.reviewRiderVerification(id, action)
      wx.showToast({ title: label + '成功', icon: 'success' })
      this.loadRiderVerifications()
    } catch (e) {}
  },
  async reviewWithdrawal(e) {
    const id = Number(e.currentTarget.dataset.id); const action = e.currentTarget.dataset.action
    const retry = e.currentTarget.dataset.retry === '1'
    if (action === 'approve') {
      if (!await this.confirm(retry ? '重试打款' : '是否确定通过', retry ? '将用原商户单号重新向微信发起转账。' : '请确认该提现申请信息无误。')) return
    } else {
      if (!await this.confirm('驳回提现申请', '驳回后金额将退回用户余额。')) return
    }
    try {
      // silent：失败时由下方 showModal 展示完整处置指引，避免 toast 一闪而过
      await admin.reviewWithdrawal(id, action, '', { silent: true })
      wx.showToast({ title: action === 'approve' ? '已通过' : '已驳回', icon: 'success' })
      this.loadWithdrawals()
    } catch (err) {
      // 提现打款失败基本都不是程序问题，而是商户侧资金/权限配置问题
      //（最常见：微信商户【运营账户】余额不足）。必须把原因和怎么处理讲清楚。
      const detail = (err && err.data) || {}
      const lines = [String((err && err.message) || '提现审核失败')]
      if (detail.hint) lines.push('', detail.hint)
      if (detail.code) lines.push('', `错误码：${detail.code}`)
      wx.showModal({ title: '打款失败', content: lines.join('\n'), showCancel: false, confirmText: '知道了' })
      this.loadWithdrawals()
    }
  },
  async toggleUser(e) { const user = this.data.users.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id)); if (!user) return; const status = user.status ? 0 : 1; if (!await this.confirm(status ? '启用账号' : '禁用账号', `确定${status ? '启用' : '禁用'} ${user.nickName} 吗？`)) return; try { await admin.updateUserStatus(user.id, status); this.loadUsers() } catch (err) {} },
  changeRole(e) { const id = Number(e.currentTarget.dataset.id); wx.showActionSheet({ itemList: ROLE_SHEET, success: async (res) => { const role = ROLE_OPTIONS[res.tapIndex]; if (!await this.confirm('修改角色', '角色变更会立即改变该账号的管理范围。')) return; try { await admin.updateUserRole(id, role); this.loadUsers() } catch (err) {} } }) },

  // ===== 管理员管理 =====
  async loadAdmins() {
    const data = await admin.admins()
    const meId = Number(this.meId || 0)
    const admins = (data.list || []).map((row) => Object.assign({}, row, { isSelf: Number(row.id) === meId }))
    this.setData({ admins })
  },

  async changeAdminRole(e) {
    const id = Number(e.currentTarget.dataset.id)
    const admin0 = this.data.admins.find((row) => Number(row.id) === id)
    if (!admin0) return
    if (admin0.isSelf) return wx.showToast({ title: '不能修改自己的角色', icon: 'none' })
    wx.showActionSheet({ itemList: ROLE_SHEET, success: async (res) => {
      const role = ROLE_OPTIONS[res.tapIndex]
      if (role === admin0.role) return
      const roleName = ROLE_SHEET[res.tapIndex]
      if (!await this.confirm('调整角色', `将 ${admin0.nickName || '用户#' + id} 设为「${roleName}」？该操作会记录到操作日志。`)) return
      try {
        await admin.updateUserRole(id, role)
        wx.showToast({ title: '角色已调整', icon: 'success' })
        this.loadAdmins()
      } catch (err) {}
    } })
  },

  async toggleAdmin(e) {
    const id = Number(e.currentTarget.dataset.id)
    const admin0 = this.data.admins.find((row) => Number(row.id) === id)
    if (!admin0) return
    if (admin0.isSelf) return wx.showToast({ title: '不能停用自己的账号', icon: 'none' })
    const status = admin0.status ? 0 : 1
    if (!await this.confirm(status ? '启用管理员' : '停用管理员', `确定${status ? '启用' : '停用'} ${admin0.nickName || '用户#' + id} 吗？停用后该账号将无法登录。`)) return
    try {
      await admin.updateUserStatus(id, status)
      wx.showToast({ title: status ? '已启用' : '已停用', icon: 'success' })
      this.loadAdmins()
    } catch (err) {}
  },

  openAdminModal() { this.setData({ showAdminModal: true, adminQuery: '', adminRoleIndex: 0 }) },
  closeAdminModal() { if (!this.data.adminSaving) this.setData({ showAdminModal: false }) },
  onAdminQueryInput(e) { this.setData({ adminQuery: e.detail.value }) },
  onAdminRoleChange(e) { this.setData({ adminRoleIndex: Number(e.detail.value) || 0 }) },
  noop() {},

  async submitAdminCreate() {
    if (this.data.adminSaving) return
    const query = String(this.data.adminQuery || '').trim()
    if (!query) return wx.showToast({ title: '请填写用户 ID / 手机号 / 学号', icon: 'none' })
    const role = CREATE_ROLE_KEYS[this.data.adminRoleIndex] || 'content_admin'
    this.setData({ adminSaving: true })
    try {
      const result = await admin.createAdmin(query, role)
      wx.showToast({ title: '已设为管理员', icon: 'success' })
      this.setData({ showAdminModal: false, adminSaving: false, adminQuery: '' })
      this.loadAdmins()
      return result
    } catch (e) {
      this.setData({ adminSaving: false })
    }
  },

  // ===== 日志 tab：跑腿订单流程（替代原管理员操作日志） =====
  onErrandKeywordInput(e) { this.setData({ errandKeyword: e.detail.value }) },
  searchErrandOrders() { this.loadErrandOrders(1) },
  chooseErrandStatus(e) {
    const value = e.currentTarget.dataset.status
    this.setData({ errandStatus: value === '' ? '' : String(value) })
    this.loadErrandOrders(1)
  },
  async loadErrandOrders(page) {
    if (this.data.errandLoading) return
    this.setData({ errandLoading: true })
    try {
      const data = await admin.errandOrders({ page: page || 1, pageSize: 20, status: this.data.errandStatus, keyword: this.data.errandKeyword })
      const list = (data.list || []).map((row) => Object.assign({}, row, formatErrandRow(row)))
      this.setData({
        errandOrders: (page || 1) <= 1 ? list : this.data.errandOrders.concat(list),
        errandPage: page || 1,
        errandHasMore: !!data.hasMore
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '订单流程加载失败', icon: 'none' })
    } finally {
      this.setData({ errandLoading: false })
    }
  },
  loadMoreErrandOrders() { if (this.data.errandHasMore) this.loadErrandOrders(this.data.errandPage + 1) },

  // ===== 日志 tab：订阅消息发送流水（客服排查「用户说收不到微信通知」）=====
  chooseLogScope(e) {
    const scope = String(e.currentTarget.dataset.scope || 'errand')
    if (scope === this.data.logScope) return
    // 切换分段时一并关掉其它分段残留的弹窗，避免「切过去又弹出来」
    this.setData({ logScope: scope, errandDetail: null, repairDetail: null })
    if (scope === 'subscribe') this.loadSubscribeLogs(1)
    else if (scope === 'repair') this.loadRepairOrders(1)
    else this.loadErrandOrders(1)
  },
  onSubscribeLogKeywordInput(e) { this.setData({ subscribeLogKeyword: e.detail.value }) },
  searchSubscribeLogs() { this.loadSubscribeLogs(1) },
  chooseSubscribeLogStatus(e) {
    const value = e.currentTarget.dataset.status
    this.setData({ subscribeLogStatus: value === '' ? '' : String(value) })
    this.loadSubscribeLogs(1)
  },
  async loadSubscribeLogs(page) {
    if (this.data.subscribeLogLoading) return
    this.setData({ subscribeLogLoading: true })
    try {
      const data = await admin.subscribeLogs({
        page: page || 1,
        pageSize: 20,
        status: this.data.subscribeLogStatus,
        keyword: this.data.subscribeLogKeyword
      })
      const list = (data.list || []).map((row) => Object.assign({}, row, {
        // 中文标签由服务端下发（subscribeService 的 TPL_CONFIG 是唯一真源）；老服务端没这字段时回落为原键
        tplLabel: row.tplLabel || row.tplType,
        statusText: SUBSCRIBE_STATUS_TEXT[row.status] || row.status,
        statusHint: SUBSCRIBE_STATUS_HINT[row.status] || '',
        errcodeHint: row.errcode ? (SUBSCRIBE_ERRCODE_HINT[Number(row.errcode)] || '') : '',
        // 必须走 fmtDateTime（按本机时区解析）。
        // 曾写成 String(row.createdAt).replace('T',' ').slice(0,19) —— 那是直接切 ISO 字符串，
        // 显示的是 UTC，比北京时间少 8 小时（截图里 #733 显示 15:49，实际是当天 23:49），
        // 排障时会误判「这条失败发生在下午」。
        timeText: fmtDateTime(row.createdAt)
      }))
      this.setData({
        subscribeLogs: (page || 1) <= 1 ? list : this.data.subscribeLogs.concat(list),
        subscribeLogPage: page || 1,
        subscribeLogHasMore: !!data.hasMore,
        subscribeQuota: (data.quota || []).map((q) => {
          const users = Number(q.users || 0)
          const remain = Number(q.remain || 0)
          const sent = Number(q.sent || 0)
          // availableUsers 是服务端后加的字段。未升级时它是 undefined，
          // 此时不能照抄「N 人有额度」的文案（数字会空着），退化成只报订阅人数。
          const availableUsers = (q.availableUsers === undefined || q.availableUsers === null)
            ? null
            : Number(q.availableUsers)
          return Object.assign({}, q, {
            label: q.label || q.tplType,
            users,
            remain,
            sent,
            availableUsers,
            quotaText: availableUsers === null
              ? `${users} 人订阅过 / 剩余 ${remain} / 已发 ${sent}`
              : `${availableUsers} 人有额度（共 ${users} 人订阅过）/ 剩余 ${remain} / 已发 ${sent}`
          })
        }),
        subscribePendingTotal: Number(data.pendingTotal || 0)
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '订阅日志加载失败', icon: 'none' })
    } finally {
      this.setData({ subscribeLogLoading: false })
    }
  },
  loadMoreSubscribeLogs() { if (this.data.subscribeLogHasMore) this.loadSubscribeLogs(this.data.subscribeLogPage + 1) },

  // ===== 日志 tab：维修信息（用户端提交的预约维修）=====
  // 用户提交预约后只落 repair_order 表，管理员此前没有入口可看，只能等用户自己反馈。
  // 这里按「预约时间倒序」列出全部预约，并把提交人的头像/昵称/手机号一并带出。
  onRepairKeywordInput(e) { this.setData({ repairKeyword: e.detail.value }) },
  searchRepairOrders() { this.loadRepairOrders(1) },
  chooseRepairStatus(e) {
    const value = e.currentTarget.dataset.status
    this.setData({ repairStatus: value === '' ? '' : String(value) })
    this.loadRepairOrders(1)
  },
  async loadRepairOrders(page) {
    if (this.data.repairLoading) return
    this.setData({ repairLoading: true })
    try {
      const data = await admin.repairOrders({
        page: page || 1,
        pageSize: 20,
        status: this.data.repairStatus,
        keyword: this.data.repairKeyword
      })
      const list = (data.list || []).map((row) => Object.assign({}, row, {
        nickName: row.nickName || ('用户 #' + row.userId),
        statusText: REPAIR_STATUS_TEXT[row.status] || row.status,
        statusClass: REPAIR_STATUS_CLASS[row.status] || 'cancelled',
        createdText: fmtDateTime(row.createdAt),
        paidText: fmtDateTime(row.paidAt),
        amountText: Number(row.amount || 0).toFixed(2),
        images: Array.isArray(row.images) ? row.images : [],
        // 上门服务内容：用户端只填了「故障描述」，device_type 是描述的前 20 字，优先展示完整描述
        serviceText: row.description || row.deviceType || '未填写'
      }))
      this.setData({
        repairOrders: (page || 1) <= 1 ? list : this.data.repairOrders.concat(list),
        repairPage: page || 1,
        repairHasMore: !!data.hasMore,
        // 列表刷新后原弹窗里的对象已过期，一并关掉
        repairDetail: null
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '维修信息加载失败', icon: 'none' })
    } finally {
      this.setData({ repairLoading: false })
    }
  },
  loadMoreRepairOrders() { if (this.data.repairHasMore) this.loadRepairOrders(this.data.repairPage + 1) },
  // 完整资料弹窗：提交人 + 上门信息 + 故障照片
  openRepairDetail(e) {
    const row = this.data.repairOrders.find((r) => Number(r.id) === Number(e.currentTarget.dataset.id))
    if (!row) return
    this.setData({ repairDetail: row })
  },
  closeRepairDetail() { this.setData({ repairDetail: null }) },
  previewRepairImage(e) {
    const detail = this.data.repairDetail
    if (!detail || !detail.images.length) return
    wx.previewImage({ current: detail.images[Number(e.currentTarget.dataset.index) || 0], urls: detail.images })
  },
  // 管理员要打电话/加微信约上门时间，联系方式支持一键复制
  copyRepairContact(e) {
    const value = String(e.currentTarget.dataset.value || '')
    if (!value) return
    wx.setClipboardData({ data: value })
  },

  // 查看订单全流程详情：双方用户信息 + 各节点时间 + 流程时间线
  async openErrandDetail(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    try {
      const data = await admin.errandOrderDetail(id)
      const order = data.order || {}
      const logs = (data.logs || []).map((log) => ({
        id: log.id,
        text: ((log.actorName || '系统') + ' ' + (ERRAND_LOG_TEXT[log.action] || log.detail || log.action)),
        detail: log.detail || '',
        timeText: fmtDateTime(log.createdAt)
      }))
      const cancelledAt = data.cancelledAt || order.cancelledAt
      this.setData({
        errandDetail: {
          id: order.id,
          title: order.title,
          rewardText: Number(order.reward || 0).toFixed(2),
          statusText: ERRAND_STATUS_TEXT[order.status] || order.status,
          paymentText: ERRAND_PAYMENT_TEXT[order.paymentStatus] || order.paymentStatus || '',
          publisherName: order.publisherName || '未知用户',
          publisherAvatar: order.publisherAvatar || '',
          publisherPhone: order.publisherPhone || order.receiver_phone || order.receiverPhone || '未绑定',
          acceptorName: order.acceptorName || '',
          acceptorAvatar: order.acceptorAvatar || '',
          acceptorPhone: order.acceptorPhone || '未绑定',
          createdAtText: fmtDateTime(order.createdAt || order.created_at),
          acceptedAtText: fmtDateTime(order.acceptedAt || order.accepted_at) || '--',
          finishedAtText: fmtDateTime(order.finishedAt || order.finished_at) || '--',
          cancelledAtText: fmtDateTime(cancelledAt) || '--',
          remark: order.remark || '',
          // 异议裁决所需的原始状态与异议内容（disputed 时展示裁决按钮）
          status: order.status,
          finishDescription: order.finish_description || '',
          finishImages: Array.isArray(order.finish_images) ? order.finish_images : [],
          disputeReason: order.dispute_reason || '',
          disputedAtText: order.disputed_at ? fmtDateTime(order.disputed_at) : '',
          disputeResultText: ERRAND_DISPUTE_RESULT_TEXT[order.dispute_result] || '',
          disputeNote: order.dispute_note || '',
          disputeHandledAtText: order.dispute_handled_at ? fmtDateTime(order.dispute_handled_at) : '',
          logs
        }
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '详情加载失败', icon: 'none' })
    }
  },
  closeErrandDetail() { this.setData({ errandDetail: null }) },

  // 订单详情内预览接单方提交的凭证图
  previewErrandImage(e) {
    const current = e.currentTarget.dataset.src
    const urls = (this.data.errandDetail && this.data.errandDetail.finishImages) || []
    if (current && urls.length) wx.previewImage({ current, urls })
  },

  // 裁决议异订单：通过 = 异议成立（订单取消，赏金原路退回发单人）；拒绝 = 异议不成立（订单成立并结算给接单方）
  async reviewErrandDispute(e) {
    const detail = this.data.errandDetail
    if (!detail || detail.status !== 'disputed') return
    const action = e.currentTarget.dataset.action === 'approve' ? 'approve' : 'reject'
    const confirmText = action === 'approve'
      ? `确认「${detail.title}」的异议成立？订单将取消，赏金按原支付路径退回发单人。`
      : `确认驳回「${detail.title}」的异议？订单将成立并显示已完成，赏金转入接单方钱包。`
    if (!await this.confirm(action === 'approve' ? '通过异议' : '拒绝异议', confirmText)) return
    try {
      await admin.reviewErrandDispute(detail.id, action)
      wx.showToast({ title: action === 'approve' ? '已通过，订单取消并退款' : '已驳回，订单成立', icon: 'none' })
      this.setData({ errandDetail: null })
      this.loadErrandOrders(1)
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '处理失败', icon: 'none' })
    }
  },

  // ===== 群聊管理 tab =====
  // 群聊模块内的两个功能区切换：群聊信息（群聊列表与类别维护，即原有页面）/ 群聊审核（用户提交的建群申请）
  switchGroupChatView(e) {
    const view = e.currentTarget.dataset.view === 'audit' ? 'audit' : 'info'
    if (view === this.data.groupChatView) return
    wx.vibrateShort({ type: 'light' })
    // 与社团功能区切换保持一致：切换时关闭进行中的表单与详情弹窗，避免跨视图残留
    this.setData({ groupChatView: view, form: null, chatApplyDetail: null })
    this.loadCurrent()
  },

  async loadGroupChatData() {
    await Promise.all([this.loadGroupChatApplies(), this.loadGroupChatGroups(), this.loadGcCategories()])
  },

  // 群聊类别：服务端维护（回退内置默认），供类别编辑列表与群聊表单选择器共用
  async loadGcCategories() {
    try {
      const data = await admin.groupChatCategories()
      const list = (data.list || []).map((row) => Object.assign({}, row, {
        statusText: row.status ? '' : '已停用'
      }))
      const names = list.filter((row) => row.status).map((row) => row.name)
      this.setData({
        gcCategories: list,
        chatCategoryNames: names.length ? names : GC_CATEGORIES
      })
    } catch (e) {
      this.setData({ gcCategories: [], chatCategoryNames: GC_CATEGORIES })
    }
  },

  chooseGcApplyStatus(e) {
    const value = e.currentTarget.dataset.status
    this.setData({ groupChatApplyStatus: value === '' ? '' : String(value) })
    this.loadGroupChatApplies()
  },

  async loadGroupChatApplies() {
    const data = await admin.groupChatApplies({ page: 1, pageSize: 50, status: this.data.groupChatApplyStatus })
    const list = (data.list || []).map((row) => Object.assign({}, row, {
      statusText: GC_APPLY_STATUS_TEXT[row.status] || row.status,
      images: Array.isArray(row.images) ? row.images : [],
      createdAtText: fmtDateTime(row.createdAt),
      reviewedAtText: row.reviewedAt ? fmtDateTime(row.reviewedAt) : '',
      // 创建人首字符头像兜底
      creatorChar: (row.nickName || '友').charAt(0),
      groupChar: (row.name || '群').charAt(0)
    }))
    this.setData({ groupChatApplies: list, chatApplyDetail: null })
  },

  // 群聊审核详情弹窗（审核 tab 用）
  viewChatApply(e) {
    const id = Number(e.currentTarget.dataset.id)
    const apply = this.data.groupChatApplies.find((row) => Number(row.id) === id)
    if (apply) this.setData({ chatApplyDetail: apply })
  },

  closeChatApplyDetail() {
    this.setData({ chatApplyDetail: null })
  },

  async loadGroupChatGroups() {
    const data = await admin.groupChatGroups({ page: 1, pageSize: 100 })
    const list = (data.list || []).map((item) => {
      const joinMode = JOIN_MODE_OPTIONS.find((opt) => opt.value === (item.joinMode || DEFAULT_JOIN_MODE)) || JOIN_MODE_OPTIONS[0]
      return Object.assign({}, item, {
        joinModeText: joinMode.label,
        // 进群方式为「扫码进群」但没传二维码：用户点进详情根本进不了群，列表上直接标红提醒
        missingQrcode: joinMode.value === 'qrcode' && !item.qrcodeUrl
      })
    })
    this.setData({ groupChatGroups: list })
  },

  // 通过/驳回：先打开审核意见表单，确认后提交（驳回必填意见）
  openChatReview(e) {
    const id = Number(e.currentTarget.dataset.id)
    const action = e.currentTarget.dataset.action === 'approve' ? 'approve' : 'reject'
    const apply = this.data.groupChatApplies.find((row) => Number(row.id) === id)
    if (!apply) return
    this.setData({ form: { kind: 'chatReview', id, action, applyName: apply.name, reviewNote: '' } })
  },

  async toggleChatGroup(e) {
    const group = this.data.groupChatGroups.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!group) return
    const status = group.status ? 0 : 1
    if (!await this.confirm(status ? '上架群聊' : '下架群聊', `确定${status ? '上架' : '下架'}「${group.name}」吗？下架后用户端立即不可见。`)) return
    try { await admin.updateGroupChatGroup(group.id, { status }); wx.showToast({ title: status ? '已上架' : '已下架', icon: 'success' }); this.loadGroupChatGroups() } catch (err) {}
  },

  async deleteChatGroup(e) {
    const group = this.data.groupChatGroups.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!group) return
    if (!await this.confirm('删除群聊', `确定删除「${group.name}」吗？删除后用户端不再展示该群聊。`)) return
    try { await admin.deleteGroupChatGroup(group.id); wx.showToast({ title: '已删除', icon: 'success' }); this.loadGroupChatGroups() } catch (err) {}
  },

  // 群聊编辑表单：字段与服务端 group_chat 表一一对应
  //   基础信息：name / categoryIndex / campus / intro / notice
  //   群成员与权限：ownerName / memberCount / joinModeIndex / needAudit
  //   展示素材：meta.avatarUrl / meta.qrcodeUrl / meta.gzhQrcodeUrl / meta.images
  //   展示与状态：isOfficial / customTag / sortOrder / status
  beginChatGroupCreate() {
    this.setData({
      form: {
        kind: 'chatGroup',
        id: 0,
        name: '',
        categoryIndex: 0,
        intro: '',
        notice: '',
        ownerName: '',
        memberCount: '',
        joinModeIndex: 0,
        needAudit: 0,
        meta: { avatarUrl: '', qrcodeUrl: '', gzhQrcodeUrl: '', images: [] },
        isOfficial: 0,
        customTag: '',
        campus: '',
        sortOrder: 0,
        status: 1
      }
    })
  },

  beginChatGroupEdit(e) {
    const group = this.data.groupChatGroups.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!group) return
    const categoryIndex = Math.max(0, this.data.chatCategoryNames.indexOf(group.category || ''))
    const joinModeIndex = Math.max(0, JOIN_MODE_OPTIONS.findIndex((item) => item.value === (group.joinMode || DEFAULT_JOIN_MODE)))
    const memberCount = Number(group.memberCount) || 0
    this.setData({
      form: {
        kind: 'chatGroup',
        id: group.id,
        name: group.name || '',
        categoryIndex,
        intro: group.intro || '',
        notice: group.notice || '',
        ownerName: group.ownerName || '',
        // 0 视为未填写，输入框留空更直观
        memberCount: memberCount > 0 ? String(memberCount) : '',
        joinModeIndex,
        needAudit: group.needAudit ? 1 : 0,
        meta: {
          avatarUrl: group.avatarUrl || '',
          qrcodeUrl: group.qrcodeUrl || '',
          gzhQrcodeUrl: group.gzhQrcodeUrl || '',
          images: Array.isArray(group.images) ? group.images : []
        },
        isOfficial: group.isOfficial ? 1 : 0,
        customTag: group.customTag || '',
        campus: group.campus || '',
        sortOrder: group.sortOrder || 0,
        status: group.status ? 1 : 0
      }
    })
  },

  onChatCategoryChange(e) { this.setData({ 'form.categoryIndex': Number(e.detail.value) || 0 }) },
  onChatJoinModeChange(e) { this.setData({ 'form.joinModeIndex': Number(e.detail.value) || 0 }) },
  formOfficial(e) { this.setData({ 'form.isOfficial': e.detail.value ? 1 : 0 }) },
  formNeedAudit(e) { this.setData({ 'form.needAudit': e.detail.value ? 1 : 0 }) },

  // 群聊表单图片介绍：多张上传
  addChatGroupImage() {
    const meta = (this.data.form && this.data.form.meta) || null
    if (!meta) return
    const remain = 5 - (meta.images || []).length
    if (remain <= 0) { wx.showToast({ title: '最多上传 5 张图片', icon: 'none' }); return }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
        if (!paths.length) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages(paths).then((urls) => {
          wx.hideLoading()
          const valid = (urls || []).filter((url) => /^https:\/\//.test(url))
          if (!valid.length) throw new Error('upload failed')
          this.setData({ 'form.meta.images': (meta.images || []).concat(valid).slice(0, 5) })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        })
      }
    })
  },

  // 清除表单内的单张图片（群头像 / 群二维码 / 公众号二维码）：置空即可，保存时不传地址
  clearFormImage(e) {
    const key = e.currentTarget.dataset.key
    if (!key || !this.data.form) return
    this.setData({ ['form.meta.' + key]: '' })
  },

  removeChatGroupImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = ((this.data.form && this.data.form.meta && this.data.form.meta.images) || []).slice()
    if (index < 0 || index >= images.length) return
    images.splice(index, 1)
    this.setData({ 'form.meta.images': images })
  },

  previewChatGroupImage(e) {
    const url = e.currentTarget.dataset.url
    const images = (this.data.form && this.data.form.meta && this.data.form.meta.images) || []
    if (url) wx.previewImage({ urls: images.length ? images : [url], current: url })
  },

  // ===== 群聊类别编辑 =====
  beginGcCategoryCreate() {
    this.setData({ form: { kind: 'gcCategory', id: 0, name: '', description: '', sortOrder: 0, status: 1 } })
  },

  beginGcCategoryEdit(e) {
    const category = this.data.gcCategories.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!category) return
    this.setData({ form: { kind: 'gcCategory', id: category.id, name: category.name || '', description: category.description || '', sortOrder: category.sortOrder || 0, status: category.status ? 1 : 0 } })
  },

  async deleteGcCategory(e) {
    const category = this.data.gcCategories.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!category) return
    if (category.groupCount > 0) {
      wx.showModal({ title: '无法删除', content: `「${category.name}」下仍有 ${category.groupCount} 个群聊，请先移动或删除这些群聊。`, showCancel: false })
      return
    }
    if (!await this.confirm('删除群聊类别', `确定删除「${category.name}」吗？删除后用户端不再展示该类别。`)) return
    try { await admin.deleteGroupChatCategory(category.id); wx.showToast({ title: '已删除', icon: 'success' }); this.loadGcCategories() } catch (err) {}
  },

  // ===== 活动管理 tab =====
  onActivityKeywordInput(e) { this.setData({ activityKeyword: e.detail.value }) },
  searchActivities() { this.loadActivities() },
  async loadActivities() {
    const data = await admin.activities({ page: 1, pageSize: 50, keyword: this.data.activityKeyword })
    const list = (data.list || []).map((row) => Object.assign({}, row, {
      badgeText: ACTIVITY_BADGE_TEXT[row.badge] || '',
      createdAtText: fmtDateTime(row.createdAt)
    }))
    this.setData({ activities: list })
  },

  // 活动详情：查看该活动的报名用户名单（入口仅出现在管理端活动卡片，接口侧校验 content.manage）
  openActivitySignups(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    this.signupActivityId = id
    this.signupSeq = 0
    this.setData({
      activitySignupKeyword: '',
      activitySignupLoading: true,
      activitySignupDetail: { activity: {}, list: [], total: 0, page: 0, hasMore: false }
    })
    this.loadActivitySignups(true)
  },

  closeActivitySignups() {
    this.signupActivityId = 0
    this.signupSeq = 0
    this.setData({ activitySignupDetail: null, activitySignupKeyword: '', activitySignupLoading: false })
  },

  onSignupKeywordInput(e) { this.setData({ activitySignupKeyword: e.detail.value }) },
  searchActivitySignups() { this.loadActivitySignups(true) },

  loadMoreActivitySignups() {
    const detail = this.data.activitySignupDetail
    if (this.data.activitySignupLoading || !detail || !detail.hasMore) return
    this.loadActivitySignups(false)
  },

  async loadActivitySignups(reset) {
    const id = this.signupActivityId
    if (!id) return
    if (!reset && this.data.activitySignupLoading) return
    const detail = this.data.activitySignupDetail || {}
    const page = reset ? 1 : (Number(detail.page) || 1) + 1
    // 请求令牌：切换活动或重复搜索时丢弃过期响应，避免旧数据覆盖新列表
    const seq = (this.signupSeq || 0) + 1
    this.signupSeq = seq
    this.setData({ activitySignupLoading: true })
    try {
      const data = await admin.activitySignups(id, { page, pageSize: 50, keyword: this.data.activitySignupKeyword })
      if (this.signupSeq !== seq || this.signupActivityId !== id) return
      const rows = (data.list || []).map((row) => Object.assign({}, row, {
        signedAtText: fmtDateTime(row.signedAt).slice(0, 16)
      }))
      const prev = reset ? [] : (detail.list || [])
      this.setData({
        activitySignupDetail: {
          activity: data.activity || {},
          list: prev.concat(rows),
          total: Number(data.total || 0),
          page,
          hasMore: !!data.hasMore
        },
        activitySignupLoading: false
      })
    } catch (err) {
      if (this.signupSeq !== seq) return
      this.setData({ activitySignupLoading: false })
      if (reset) this.setData({ activitySignupDetail: null })
    }
  },

  // 点击手机号复制，便于管理员线下联系报名用户
  copySignupPhone(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim()
    if (phone) wx.setClipboardData({ data: phone })
  },

  beginActivityEdit(e) {
    const activity = this.data.activities.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!activity) return
    this.setData({
      form: {
        kind: 'activity',
        id: activity.id,
        title: activity.title || '',
        signupStart: fmtDateTime(activity.signupStart).slice(0, 16),
        signupEnd: fmtDateTime(activity.signupEnd).slice(0, 16),
        activityStart: fmtDateTime(activity.activityStart).slice(0, 16),
        activityEnd: fmtDateTime(activity.activityEnd).slice(0, 16),
        location: activity.location || '',
        address: activity.address || '',
        campus: activity.campus || '',
        capacity: activity.capacity || 0,
        meta: { coverUrl: activity.coverUrl || '', images: Array.isArray(activity.images) ? activity.images : [] },
        detailTitle: activity.detailTitle || '',
        detailContent: activity.detailContent || '',
        signupTitle: activity.signupTitle || '',
        signupContent: activity.signupContent || '',
        status: activity.status ? 1 : 0
      }
    })
  },

  async toggleActivity(e) {
    const activity = this.data.activities.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!activity) return
    const status = activity.status ? 0 : 1
    if (!await this.confirm(status ? '上架活动' : '下架活动', `确定${status ? '上架' : '下架'}「${activity.title}」吗？下架后用户端立即不可见。`)) return
    try { await admin.updateActivity(activity.id, { status }); wx.showToast({ title: status ? '已上架' : '已下架', icon: 'success' }); this.loadActivities() } catch (err) {}
  },

  async deleteActivity(e) {
    const activity = this.data.activities.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!activity) return
    if (!await this.confirm('删除活动', `确定删除「${activity.title}」吗？删除后用户端不再展示该活动。`)) return
    try { await admin.deleteActivity(activity.id); wx.showToast({ title: '已删除', icon: 'success' }); this.loadActivities() } catch (err) {}
  },

  // ===== 社团管理 tab =====
  // 社团模块内的两个功能区切换：社团分类管理（现有页面）/ 社团审核
  switchClubView(e) {
    const view = e.currentTarget.dataset.view === 'audit' ? 'audit' : 'categories'
    if (view === this.data.clubAuditView) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ clubAuditView: view, form: null, clubAuditDetail: null })
    this.loadCurrent()
  },

  async loadClubCategories() {
    const data = await admin.clubCategories()
    const list = (data.list || []).map((row) => Object.assign({}, row, {
      scope: Array.isArray(row.scope) ? row.scope : [],
      features: Array.isArray(row.features) ? row.features : [],
      clubs: Array.isArray(row.clubs) ? row.clubs : []
    }))
    this.setData({ clubCategories: list, clubCategoryNames: list.map((row) => row.name) })
  },

  toggleExpandClubCategory(e) {
    const id = Number(e.currentTarget.dataset.id)
    this.setData({ expandedClubCategory: this.data.expandedClubCategory === id ? -1 : id })
  },

  async deleteClubCategory(e) {
    const category = this.data.clubCategories.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!category) return
    if (!await this.confirm('删除社团分类', `确定删除「${category.name}」吗？该分类及其中 ${category.clubTotal} 个社团将一并隐藏，用户端立即不再展示。`)) return
    try { await admin.deleteClubCategory(category.id); wx.showToast({ title: '已删除', icon: 'success' }); this.loadClubCategories() } catch (err) {}
  },

  async toggleClub(e) {
    const club = this.findClubById(Number(e.currentTarget.dataset.id))
    if (!club) return
    const status = club.status ? 0 : 1
    if (!await this.confirm(status ? '上架社团' : '下架社团', `确定${status ? '上架' : '下架'}「${club.name}」吗？`)) return
    try { await admin.updateClub(club.id, { status }); wx.showToast({ title: status ? '已上架' : '已下架', icon: 'success' }); this.loadClubCategories() } catch (err) {}
  },

  async deleteClub(e) {
    const club = this.findClubById(Number(e.currentTarget.dataset.id))
    if (!club) return
    if (!await this.confirm('删除社团', `确定删除「${club.name}」吗？删除后无法恢复。`)) return
    try { await admin.deleteClub(club.id); wx.showToast({ title: '已删除', icon: 'success' }); this.loadClubCategories() } catch (err) {}
  },

  findClubById(id) {
    for (const category of this.data.clubCategories) {
      const club = (category.clubs || []).find((row) => Number(row.id) === id)
      if (club) return club
    }
    return null
  },

  // ===== 社团审核（用户端「申请创建社团」提交的申请） =====
  chooseClubApplyStatus(e) {
    const value = e.currentTarget.dataset.status
    this.setData({ clubApplyStatus: value === '' ? '' : String(value) })
    this.loadClubApplies()
  },

  async loadClubApplies() {
    const seq = (this._clubApplySeq = (this._clubApplySeq || 0) + 1)
    const data = await admin.clubApplies({ page: 1, pageSize: 50, status: this.data.clubApplyStatus })
    if (seq !== this._clubApplySeq) return
    const list = (data.list || []).map((row) => Object.assign({}, row, {
      statusText: CLUB_APPLY_STATUS_TEXT[row.status] || row.status,
      images: Array.isArray(row.images) ? row.images : [],
      createdAtText: fmtDateTime(row.createdAt),
      reviewedAtText: row.reviewedAt ? fmtDateTime(row.reviewedAt) : '',
      // 申请人首字符头像兜底
      creatorChar: (row.nickName || '友').charAt(0),
      clubChar: (row.name || '社').charAt(0)
    }))
    this.setData({ clubApplies: list, clubAuditDetail: null })
  },

  // 申请详情弹窗：申请人头像、昵称、手机号等个人信息与全部申请材料
  viewClubApply(e) {
    const id = Number(e.currentTarget.dataset.id)
    const apply = this.data.clubApplies.find((row) => Number(row.id) === id)
    if (apply) this.setData({ clubAuditDetail: apply })
  },

  closeClubApplyDetail() {
    this.setData({ clubAuditDetail: null })
  },

  previewClubApplyImg(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const apply = this.data.clubAuditDetail
    const urls = apply ? [apply.avatarUrl, apply.qrcodeUrl, apply.adminQrcodeUrl, apply.gzhQrcodeUrl].filter(Boolean).concat(apply.images || []) : [url]
    wx.previewImage({ urls: urls.length ? urls : [url], current: url })
  },

  // 通过/驳回：先打开审核意见表单，确认后提交（驳回必填意见）
  openClubReview(e) {
    const id = Number(e.currentTarget.dataset.id)
    const action = e.currentTarget.dataset.action === 'approve' ? 'approve' : 'reject'
    const apply = this.data.clubApplies.find((row) => Number(row.id) === id)
    if (!apply) return
    this.setData({ form: { kind: 'clubReview', id, action, applyName: apply.name, reviewNote: '' } })
  },

  beginClubCategoryCreate() {
    this.setData({ form: { kind: 'clubCategory', id: 0, name: '', iconChar: '', slogan: '', meta: { color: '#2E6BFF' }, position: '', scopeIntro: '', scopeText: '', featuresText: '', contact: '', sortOrder: 0, status: 1 } })
  },

  beginClubCategoryEdit(e) {
    const category = this.data.clubCategories.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!category) return
    this.setData({
      form: {
        kind: 'clubCategory',
        id: category.id,
        name: category.name || '',
        iconChar: category.iconChar || '',
        slogan: category.slogan || '',
        meta: { color: category.color || '#2E6BFF' },
        position: category.position || '',
        scopeIntro: category.scopeIntro || '',
        scopeText: (category.scope || []).join('、'),
        featuresText: (category.features || []).map((item) => item.title + '|' + item.desc).join('\n'),
        contact: category.contact || '',
        sortOrder: category.sortOrder || 0,
        status: category.status ? 1 : 0
      }
    })
  },

  beginClubCreate(e) {
    const categoryId = Number(e.currentTarget.dataset.id)
    const categoryName = String(e.currentTarget.dataset.name || '')
    const index = this.data.clubCategories.findIndex((row) => Number(row.id) === categoryId)
    this.setData({ form: { kind: 'club', id: 0, categoryId, categoryIndex: Math.max(0, index), clubType: '学生社团', name: '', tags: '', intro: '', recruit: '', campus: '', sortOrder: 0, status: 1, meta: { avatarUrl: '', qrcodeUrl: '', adminQrcodeUrl: '', gzhQrcodeUrl: '', images: [] } } })
  },

  beginClubEdit(e) {
    const clubId = Number(e.currentTarget.dataset.id)
    const club = this.findClubById(clubId)
    if (!club) return
    const category = this.data.clubCategories.find((row) => (row.clubs || []).some((row2) => Number(row2.id) === clubId))
    const index = this.data.clubCategories.findIndex((row) => row.id === (category || {}).id)
    this.setData({ form: { kind: 'club', id: club.id, categoryId: (category || {}).id || 0, categoryIndex: Math.max(0, index), clubType: club.clubType || '学生社团', name: club.name || '', tags: club.tags || '', intro: club.intro || '', recruit: club.recruit || '', campus: club.campus || '', sortOrder: club.sortOrder || 0, status: club.status ? 1 : 0, meta: { avatarUrl: club.avatarUrl || '', qrcodeUrl: club.qrcodeUrl || '', adminQrcodeUrl: club.adminQrcodeUrl || '', gzhQrcodeUrl: club.gzhQrcodeUrl || '', images: Array.isArray(club.images) ? club.images : [] } } })
  },

  onClubCategoryChange(e) {
    const index = Number(e.detail.value) || 0
    const category = this.data.clubCategories[index]
    this.setData({ 'form.categoryIndex': index, 'form.categoryId': category ? category.id : 0 })
  },

  // 表单内校区选择（全部校区 + 四个校区）
  onFormCampus(e) {
    this.setData({ 'form.campus': e.currentTarget.dataset.value || '' })
  },

  formInput(e) { const key = e.currentTarget.dataset.key; this.setData({ ['form.' + key]: e.detail.value }) },
  formStatus(e) { this.setData({ 'form.status': e.detail.value ? 1 : 0 }) },

  // 取消：与打开表单时的快照比对，有未保存的修改时先二次确认，避免误触丢数据
  async closeForm() {
    if (this.data.saving) return
    const form = this.data.form
    if (form && this._formSnapshot && JSON.stringify(form) !== this._formSnapshot) {
      const ok = await this.confirm('放弃修改', '表单中有未保存的修改，关闭后将会丢失。确定关闭吗？')
      if (!ok) return
    }
    this.setData({ form: null })
  },
  async saveForm() {
    const form = this.data.form; if (!form || this.data.saving) return
    this.setData({ saving: true })
    try {
      if (form.kind === 'post') await admin.updatePost(form.id, form)
      if (form.kind === 'content') {
        const payload = Object.assign({}, form)
        if (form.type === 'banner' || form.type === 'notice' || form.type === 'publish_banner') payload.body = JSON.stringify(form.meta || {})
        // 标签：描述文字存 meta.text，颜色随 meta 一起存入 body JSON（兼容旧纯文本格式，见 parseContentMeta）
        if (form.type === 'tag') payload.body = JSON.stringify({ text: String(form.body || ''), bgColor: form.meta.bgColor || '', textColor: form.meta.textColor || '' })
        if (form.type === 'banner' && (!String(form.title || '').trim() || !(form.meta && form.meta.image))) {
          wx.showToast({ title: '请填写标题并上传轮播图片', icon: 'none' })
          return
        }
        if (form.type === 'notice' && !String(form.title || '').trim()) {
          wx.showToast({ title: '请填写公告文字', icon: 'none' })
          return
        }
        form.id ? await admin.updateContent(form.id, payload) : await admin.createContent(payload)
      }
      if (form.kind === 'item') form.id ? await admin.updateItem(form.id, form) : await admin.createItem(form)
      if (form.kind === 'service') {
        if (!String(form.name || '').trim()) { wx.showToast({ title: '请填写服务名称', icon: 'none' }); return }
        if (!form.categoryId) { wx.showToast({ title: '请选择所属分类', icon: 'none' }); return }
        const payload = { categoryId: form.categoryId, name: String(form.name).trim(), icon: String(form.icon || '').trim(), iconPath: String(form.iconPath || '').trim(), badge: String(form.badge || '').trim(), link: String(form.link || '').trim(), miniAppId: String(form.miniAppId || '').trim(), sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
        form.id ? await admin.updateService(form.id, payload) : await admin.createService(payload)
      }
      if (form.kind === 'drivingSchool') {
        if (!String(form.name || '').trim()) { wx.showToast({ title: '请填写驾校名称', icon: 'none' }); return }
        const payload = this.buildSchoolPayload(form)
        form.id ? await admin.updateDrivingSchool(form.id, payload) : await admin.createDrivingSchool(payload)
      }
      if (form.kind === 'chatReview') {
        const isApprove = form.action === 'approve'
        const note = String(form.reviewNote || '').trim()
        if (!isApprove && !note) { wx.showToast({ title: '驳回时请填写审核意见', icon: 'none' }); return }
        if (!await this.confirm(isApprove ? '确认通过建群申请' : '确认驳回建群申请', isApprove ? '通过后「' + form.applyName + '」将立即上架到用户端群聊列表。' : '驳回后用户将在「我的申请」中看到审核意见。')) return
        await admin.reviewGroupChatApply(form.id, form.action, note)
        wx.showToast({ title: isApprove ? '已通过并上架' : '已驳回', icon: 'success' })
        this.setData({ form: null })
        await this.loadGroupChatData()
        return
      }
      if (form.kind === 'clubReview') {
        const isApprove = form.action === 'approve'
        const note = String(form.reviewNote || '').trim()
        if (!isApprove && !note) { wx.showToast({ title: '驳回时请填写审核意见', icon: 'none' }); return }
        if (!await this.confirm(isApprove ? '确认通过社团申请' : '确认驳回社团申请', isApprove ? '通过后「' + form.applyName + '」将立即出现在用户端「社团&组织」的对应分类中。' : '驳回后用户将在「我的社团申请」中看到审核意见。')) return
        await admin.reviewClubApply(form.id, form.action, note)
        wx.showToast({ title: isApprove ? '已通过并上架' : '已驳回', icon: 'success' })
        this.setData({ form: null })
        await this.loadClubApplies()
        return
      }
      if (form.kind === 'clubCategory') {
        const scope = String(form.scopeText || '').split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean)
        const features = String(form.featuresText || '').split('\n').map((line) => {
          const idx = line.indexOf('|')
          if (idx < 0) return null
          const title = line.slice(0, idx).trim()
          const desc = line.slice(idx + 1).trim()
          return title && desc ? { title, desc } : null
        }).filter(Boolean)
        if (!String(form.name || '').trim()) { wx.showToast({ title: '请填写分类名称', icon: 'none' }); return }
        if (!features.length && String(form.featuresText || '').trim()) { wx.showToast({ title: '特色说明格式应为：标题|描述', icon: 'none' }); return }
        const payload = { name: String(form.name).trim(), iconChar: String(form.iconChar || '').trim(), slogan: String(form.slogan || '').trim(), color: form.meta.color || '#2E6BFF', position: String(form.position || '').trim(), scopeIntro: String(form.scopeIntro || '').trim(), scope, features, contact: String(form.contact || '').trim(), sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
        form.id ? await admin.updateClubCategory(form.id, payload) : await admin.createClubCategory(payload)
      }
      if (form.kind === 'club') {
        if (!form.categoryId) { wx.showToast({ title: '请选择所属分类', icon: 'none' }); return }
        if (!String(form.name || '').trim()) { wx.showToast({ title: '请填写社团名称', icon: 'none' }); return }
        const meta = form.meta || {}
        const payload = { categoryId: form.categoryId, name: String(form.name).trim(), tags: String(form.tags || '').trim(), intro: String(form.intro || '').trim(), recruit: String(form.recruit || '').trim(), campus: form.campus || '', sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0, clubType: String(form.clubType || '学生社团').trim() || '学生社团', avatarUrl: meta.avatarUrl || '', qrcodeUrl: meta.qrcodeUrl || '', adminQrcodeUrl: meta.adminQrcodeUrl || '', gzhQrcodeUrl: meta.gzhQrcodeUrl || '', images: Array.isArray(meta.images) ? meta.images : [] }
        form.id ? await admin.updateClub(form.id, payload) : await admin.createClub(payload)
      }
      if (form.kind === 'activityAudit') {
        const note = String(form.reviewNote || '').trim()
        if (!note) { wx.showToast({ title: '驳回时请填写审核意见', icon: 'none' }); return }
        if (!await this.confirm('确认驳回活动', `驳回后「${form.activityTitle}」不会公开，发起人可在活动详情看到审核意见。`)) return
        await admin.auditActivity(form.id, 'reject', note)
        wx.showToast({ title: '已驳回', icon: 'success' })
        this.setData({ form: null })
        await this.loadActivityAudits()
        return
      }
      if (form.kind === 'gcCategory') {
        if (!String(form.name || '').trim()) { wx.showToast({ title: '请填写类别名称', icon: 'none' }); return }
        const payload = { name: String(form.name).trim(), description: String(form.description || '').trim(), sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
        form.id ? await admin.updateGroupChatCategory(form.id, payload) : await admin.createGroupChatCategory(payload)
      }
      if (form.kind === 'chatGroup') {
        const name = String(form.name || '').trim()
        if (!name) { wx.showToast({ title: '请填写群聊名称', icon: 'none' }); return }
        if (name.length > 30) { wx.showToast({ title: '群聊名称最多 30 个字', icon: 'none' }); return }
        const category = this.data.chatCategoryNames[form.categoryIndex] || ''
        if (!category) { wx.showToast({ title: '请选择群类别', icon: 'none' }); return }
        const intro = String(form.intro || '').trim()
        if (!intro) { wx.showToast({ title: '请填写群介绍，用户端群聊列表会展示', icon: 'none' }); return }
        const notice = String(form.notice || '').trim()
        if (notice.length > 500) { wx.showToast({ title: '群公告最多 500 个字', icon: 'none' }); return }
        const ownerName = String(form.ownerName || '').trim()
        if (ownerName.length > 32) { wx.showToast({ title: '群主昵称最多 32 个字', icon: 'none' }); return }
        // 成员数：留空按 0 处理；输入框是 type=number，但仍可能粘贴非数字，这里兜一层
        const memberRaw = String(form.memberCount === undefined || form.memberCount === null ? '' : form.memberCount).trim()
        let memberCount = 0
        if (memberRaw) {
          if (!/^\d+$/.test(memberRaw)) { wx.showToast({ title: '群成员数只能填写整数', icon: 'none' }); return }
          memberCount = Number(memberRaw)
          if (memberCount > MAX_MEMBER_COUNT) { wx.showToast({ title: '群成员数不能超过 ' + MAX_MEMBER_COUNT, icon: 'none' }); return }
        }
        const sortRaw = String(form.sortOrder === undefined || form.sortOrder === null ? '' : form.sortOrder).trim()
        if (sortRaw && !/^-?\d+$/.test(sortRaw)) { wx.showToast({ title: '排序需填写整数', icon: 'none' }); return }
        const meta = form.meta || {}
        const joinMode = (JOIN_MODE_OPTIONS[form.joinModeIndex] || JOIN_MODE_OPTIONS[0]).value
        if (joinMode === 'qrcode' && !meta.qrcodeUrl) {
          wx.showToast({ title: '进群方式为「扫码进群」时请先上传群二维码', icon: 'none' }); return
        }
        const images = Array.isArray(meta.images) ? meta.images : []
        if (images.length > 5) { wx.showToast({ title: '图片介绍最多 5 张', icon: 'none' }); return }
        const payload = {
          name,
          category,
          campus: form.campus || '',
          intro,
          notice,
          ownerName,
          memberCount,
          joinMode,
          needAudit: form.needAudit ? 1 : 0,
          images,
          avatarUrl: meta.avatarUrl || '',
          qrcodeUrl: meta.qrcodeUrl || '',
          gzhQrcodeUrl: meta.gzhQrcodeUrl || '',
          isOfficial: form.isOfficial ? 1 : 0,
          customTag: String(form.customTag || '').trim(),
          sortOrder: sortRaw ? Number(sortRaw) : 0,
          status: form.status ? 1 : 0
        }
        form.id ? await admin.updateGroupChatGroup(form.id, payload) : await admin.createGroupChatGroup(payload)
      }
      if (form.kind === 'activity') {
        const DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
        if (!String(form.title || '').trim()) { wx.showToast({ title: '请填写活动标题', icon: 'none' }); return }
        const timeFields = [['signupStart', '报名时间'], ['signupEnd', '报名截止'], ['activityStart', '活动开始'], ['activityEnd', '活动结束']]
        const payload = { title: String(form.title).trim() }
        for (const [key, label] of timeFields) {
          const value = String(form[key] || '').trim()
          if (value && !DT_RE.test(value)) { wx.showToast({ title: label + '格式需为 YYYY-MM-DD HH:mm', icon: 'none' }); return }
          payload[key] = value
        }
        payload.location = String(form.location || '').trim()
        payload.address = String(form.address || '').trim()
        payload.campus = form.campus || ''
        payload.detailTitle = String(form.detailTitle || '').trim()
        payload.detailContent = String(form.detailContent || '').trim()
        payload.signupTitle = String(form.signupTitle || '').trim()
        payload.signupContent = String(form.signupContent || '').trim()
        payload.coverUrl = form.meta.coverUrl || ''
        payload.images = Array.isArray(form.meta.images) ? form.meta.images : []
        const capacity = parseInt(form.capacity, 10)
        payload.capacity = Number.isInteger(capacity) && capacity > 0 ? capacity : 0
        await admin.updateActivity(form.id, payload)
      }
      wx.showToast({ title: '已保存', icon: 'success' }); this.setData({ form: null }); this.loadCurrent()
    } catch (e) {} finally { this.setData({ saving: false }) }
  },

  editCertLabel(e) {
    const userId = Number(e.currentTarget.dataset.id)
    const currentLabel = String(e.currentTarget.dataset.certlabel || '')
    this.setData({ showCertModal: true, certUserId: userId, certDraft: currentLabel })
  },

  onCertInput(e) { this.setData({ certDraft: e.detail.value }) },

  previewVerifyImg(e) {
    const src = e.currentTarget.dataset.src
    if (src) wx.previewImage({ urls: [src], current: src })
  },

  // 长按认证截图：统一二维码识别菜单（识别 / 预览）
  onImageQrScan(e) {
    const src = e.currentTarget.dataset.src
    qr.recognize(src, src ? [src] : [])
  },

  closeCertModal() {
    if (!this.data.savingCert) this.setData({ showCertModal: false, certUserId: 0, certDraft: '' })
  },

  async saveCertLabel() {
    if (this.data.savingCert) return
    const userId = this.data.certUserId
    if (!userId) return
    const certLabel = String(this.data.certDraft || '').trim()
    this.setData({ savingCert: true })
    try {
      await admin.updateCertLabel(userId, certLabel)
      wx.showToast({ title: certLabel ? '认证已设置' : '认证已清除', icon: 'success' })
      this.setData({ showCertModal: false, certUserId: 0, certDraft: '', savingCert: false })
      this.loadUsers()
    } catch (e) {
      this.setData({ savingCert: false })
    }
  }
})
