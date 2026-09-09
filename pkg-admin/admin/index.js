const admin = require('../utils/admin')
const wechat = require('../../utils/wechat')
const qr = require('../../utils/qr')
const { runPullDownRefresh } = require('../../utils/refresh')

const TAB_PERMISSIONS = {
  overview: 'stats.view',
  reports: 'content.manage',
  posts: 'content.manage',
  content: 'config.manage',
  items: 'item.manage',
  clubGroup: 'config.manage',
  // 合并父级菜单：拥有任一子页权限即可见（数组=或关系）
  userAdmin: ['user.manage', 'admin.manage'],
  review: ['payment.manage', 'user.manage'],
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

// ===== 群聊管理：建群申请状态与可选群类别（与用户端 apply 页一致） =====
const GC_APPLY_STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '已驳回' }
const GC_CATEGORIES = ['新生群', '班级/学院群', '社团/组织群', '学习交流群', '兴趣圈子', '二手/闲置群', '搭子/拼车群', '校园资讯', '其他']

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
  club_category: '社团分类', club: '社团', group_chat_apply: '建群申请', group_chat: '群聊'
}
const ACTION_TEXT_MAP = {
  'content.create': '新增内容配置',
  'content.update': '更新内容配置',
  'content.delete': '删除内容配置',
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
  'groupchat.apply.approve': '通过建群申请',
  'groupchat.apply.reject': '驳回建群申请',
  'groupchat.group.create': '新增群聊',
  'groupchat.group.update': '更新群聊',
  'groupchat.group.delete': '删除群聊'
}

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
const ERRAND_STATUS_TEXT = { pending: '待接单', accepted: '进行中', finished: '已完成', cancelled: '已取消' }
const ERRAND_PAYMENT_TEXT = { UNPAID: '未支付', PREPAY: '支付中', SUCCESS: '已支付', REFUNDING: '退款中', REFUNDED: '已退款', CLOSED: '已关闭' }
const ERRAND_LOG_TEXT = {
  created: '发布订单，等待同学接单',
  accepted: '接单，订单进行中',
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
    rewardText: Number(row.reward || 0).toFixed(2)
  }
}

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
    users: [],
    withdrawals: [],
    riderVerifications: [],
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
    // 群聊管理 tab：建群申请审核 + 群聊上下架
    groupChatApplies: [],
    groupChatApplyStatus: 'pending',
    groupChatGroups: [],
    chatCategoryNames: GC_CATEGORIES,
    // 社团管理 tab：分类（含各分类下社团明细）+ 展开状态
    clubCategories: [],
    clubCategoryNames: [],
    expandedClubCategory: -1,
    form: null,
    saving: false,
    showCertModal: false,
    certUserId: 0,
    certDraft: '',
    savingCert: false
  },

  async onLoad() {
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
        { key: 'clubGroup', name: '社团/群聊' },
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
    // 返回本页时重启轮询并立即刷新概览，保证数字尽量新
    if (this.data.ready && this.data.activeTab === 'overview') this.refreshStats(true)
    if (this.data.ready) this.startStatsTimer()
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
      if (tab === 'items') this.setData({ items: (await admin.items()).list || [] })
      if (tab === 'clubGroup' && this.data.activeSubTab === 'groupChat') await this.loadGroupChatData()
      if (tab === 'clubGroup' && this.data.activeSubTab === 'clubs') await this.loadClubCategories()
      if (tab === 'userAdmin' && this.data.activeSubTab === 'users') await this.loadUsers()
      if (tab === 'userAdmin' && this.data.activeSubTab === 'admins') await this.loadAdmins()
      if (tab === 'review' && this.data.activeSubTab === 'withdrawals') await this.loadWithdrawals()
      if (tab === 'review' && this.data.activeSubTab === 'riderVerifications') await this.loadRiderVerifications()
      if (tab === 'logs') await this.loadErrandOrders(1)
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

  onUserKeyword(e) { this.setData({ userKeyword: e.detail.value }) },
  async loadUsers() { const data = await admin.users({ keyword: this.data.userKeyword, page: 1, pageSize: 50 }); this.setData({ users: data.list || [] }) },
  searchUsers() { this.loadUsers() },
  async loadWithdrawals() { const data = await admin.withdrawals({ page: 1, pageSize: 50, status: 'PENDING' }); this.setData({ withdrawals: data.list || [] }) },
  async loadRiderVerifications() { const data = await admin.riderVerifications({ page: 1, pageSize: 50 }); this.setData({ riderVerifications: data.list || [] }) },
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
    if (action === 'approve') {
      if (!await this.confirm('是否确定通过', '请确认该提现申请信息无误。')) return
    } else {
      if (!await this.confirm('驳回提现申请', '驳回后金额将退回用户余额。')) return
    }
    try { await admin.reviewWithdrawal(id, action); wx.showToast({ title: action === 'approve' ? '已通过' : '已驳回', icon: 'success' }); this.loadWithdrawals() } catch (e) {}
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
          logs
        }
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '详情加载失败', icon: 'none' })
    }
  },
  closeErrandDetail() { this.setData({ errandDetail: null }) },

  // ===== 群聊管理 tab =====
  async loadGroupChatData() {
    await Promise.all([this.loadGroupChatApplies(), this.loadGroupChatGroups()])
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
      createdAtText: fmtDateTime(row.createdAt)
    }))
    this.setData({ groupChatApplies: list })
  },

  async loadGroupChatGroups() {
    const data = await admin.groupChatGroups({ page: 1, pageSize: 100 })
    this.setData({ groupChatGroups: data.list || [] })
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

  beginChatGroupCreate() {
    this.setData({ form: { kind: 'chatGroup', id: 0, name: '', categoryIndex: 0, intro: '', meta: { avatarUrl: '', qrcodeUrl: '' }, sortOrder: 0, status: 1 } })
  },

  beginChatGroupEdit(e) {
    const group = this.data.groupChatGroups.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (!group) return
    const categoryIndex = Math.max(0, GC_CATEGORIES.indexOf(group.category || ''))
    this.setData({ form: { kind: 'chatGroup', id: group.id, name: group.name || '', categoryIndex, intro: group.intro || '', meta: { avatarUrl: group.avatarUrl || '', qrcodeUrl: group.qrcodeUrl || '' }, sortOrder: group.sortOrder || 0, status: group.status ? 1 : 0 } })
  },

  onChatCategoryChange(e) { this.setData({ 'form.categoryIndex': Number(e.detail.value) || 0 }) },

  // ===== 社团管理 tab =====
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
    this.setData({ form: { kind: 'club', id: 0, categoryId, categoryIndex: Math.max(0, index), name: '', tags: '', intro: '', recruit: '', sortOrder: 0, status: 1 } })
  },

  beginClubEdit(e) {
    const clubId = Number(e.currentTarget.dataset.id)
    const club = this.findClubById(clubId)
    if (!club) return
    const category = this.data.clubCategories.find((row) => (row.clubs || []).some((row2) => Number(row2.id) === clubId))
    const index = this.data.clubCategories.findIndex((row) => row.id === (category || {}).id)
    this.setData({ form: { kind: 'club', id: club.id, categoryId: (category || {}).id || 0, categoryIndex: Math.max(0, index), name: club.name || '', tags: club.tags || '', intro: club.intro || '', recruit: club.recruit || '', sortOrder: club.sortOrder || 0, status: club.status ? 1 : 0 } })
  },

  onClubCategoryChange(e) {
    const index = Number(e.detail.value) || 0
    const category = this.data.clubCategories[index]
    this.setData({ 'form.categoryIndex': index, 'form.categoryId': category ? category.id : 0 })
  },

  formInput(e) { const key = e.currentTarget.dataset.key; this.setData({ ['form.' + key]: e.detail.value }) },
  formStatus(e) { this.setData({ 'form.status': e.detail.value ? 1 : 0 }) },
  closeForm() { this.setData({ form: null }) },
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
        const payload = { categoryId: form.categoryId, name: String(form.name).trim(), tags: String(form.tags || '').trim(), intro: String(form.intro || '').trim(), recruit: String(form.recruit || '').trim(), sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
        form.id ? await admin.updateClub(form.id, payload) : await admin.createClub(payload)
      }
      if (form.kind === 'chatGroup') {
        if (!String(form.name || '').trim()) { wx.showToast({ title: '请填写群聊名称', icon: 'none' }); return }
        const payload = { name: String(form.name).trim(), category: GC_CATEGORIES[form.categoryIndex] || '', intro: String(form.intro || '').trim(), avatarUrl: form.meta.avatarUrl || '', qrcodeUrl: form.meta.qrcodeUrl || '', sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
        form.id ? await admin.updateGroupChatGroup(form.id, payload) : await admin.createGroupChatGroup(payload)
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
