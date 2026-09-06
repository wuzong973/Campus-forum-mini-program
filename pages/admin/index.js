const admin = require('../../utils/admin')
const wechat = require('../../utils/wechat')
const { runPullDownRefresh } = require('../../utils/refresh')

const TAB_PERMISSIONS = {
  overview: 'stats.view',
  reports: 'content.manage',
  posts: 'content.manage',
  content: 'config.manage',
  items: 'item.manage',
  users: 'user.manage',
  admins: 'admin.manage',
  withdrawals: 'payment.manage',
  riderVerifications: 'user.manage',
  logs: 'admin.manage'
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

function pad2(n) { return (n < 10 ? '0' : '') + n }

Page({
  data: {
    ready: false,
    role: '',
    permissions: [],
    activeTab: 'overview',
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
    features: [],
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
    logs: [],
    logsPage: 1,
    logsHasMore: false,
    logAction: '',
    logsLoading: false,
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
        { key: 'users', name: '用户' },
        { key: 'admins', name: '管理员' },
        { key: 'withdrawals', name: '提现审核' },
        { key: 'riderVerifications', name: '认证审核' },
        { key: 'logs', name: '日志' }
      ].filter((tab) => this.can(access.permissions || [], TAB_PERMISSIONS[tab.key]))
      if (!tabs.length) throw new Error('无可用管理权限')
      this.setData({ ready: true, role: access.role, permissions: access.permissions || [], tabs, activeTab: tabs[0].key })
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
      if (tab === 'users') await this.loadUsers()
      if (tab === 'admins') await this.loadAdmins()
      if (tab === 'withdrawals') await this.loadWithdrawals()
      if (tab === 'riderVerifications') await this.loadRiderVerifications()
      if (tab === 'logs') await this.loadLogs(1)
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
      this.setData({ stats, statsUpdatedAt: stamp })
    } catch (e) {
      if (!silent) wx.showToast({ title: (e && e.message) || '统计数据加载失败', icon: 'none' })
    }
  },

  refreshStatsTap() { this.refreshStats(false) },

  switchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key, selectedPostIds: [], form: null })
    this.loadCurrent()
  },

  async loadPosts() {
    const data = await admin.posts({ status: this.data.postStatus, keyword: this.data.postKeyword, page: 1, pageSize: 50 })
    this.setData({ posts: data.list || [], selectedPostIds: [] })
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
  selectPosts(e) { this.setData({ selectedPostIds: (e.detail.value || []).map(Number) }) },

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
  async loadContent() { const data = await admin.content(this.data.contentType); const features = await admin.features(); this.setData({ contentList: data.list || [], features: features.list || [] }) },
  // 轮播/公告的 body 存 JSON，表单里拆成结构化字段；分类/标签仍用纯文本
  emptyContentMeta(type) {
    if (type === 'banner') return { image: '', subtitle: '', tag: '', link: '', accent: '' }
    if (type === 'notice') return { tailText: '', tailImage: '' }
    if (type === 'publish_banner') return { style: 'red', styleIndex: 0, icon: '' }
    return null
  },
  parseContentMeta(type, body) {
    let meta = {}
    try { meta = JSON.parse(body) || {} } catch (e) {}
    if (type === 'banner') return { image: meta.image || '', subtitle: meta.subtitle || '', tag: meta.tag || '', link: meta.link || '', accent: meta.accent || '' }
    if (type === 'notice') return { tailText: meta.tailText || '', tailImage: meta.tailImage || '' }
    if (type === 'publish_banner') {
      const styleIndex = Math.max(0, BANNER_STYLE_VALUES.indexOf(meta.style || 'red'))
      return { style: BANNER_STYLE_VALUES[styleIndex], styleIndex, icon: meta.icon || '' }
    }
    return null
  },
  onFormStyleChange(e) {
    const index = Number(e.detail.value) || 0
    this.setData({ 'form.meta.styleIndex': index, 'form.meta.style': BANNER_STYLE_VALUES[index] })
  },
  beginContentCreate() { this.setData({ form: Object.assign({ kind: 'content', type: this.data.contentType, title: '', body: '', status: 1, sortOrder: 0 }, { meta: this.emptyContentMeta(this.data.contentType) }) }) },
  beginContentEdit(e) {
    const item = this.data.contentList.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id))
    if (item) this.setData({ form: Object.assign({ kind: 'content' }, item, { meta: this.parseContentMeta(item.type, item.body) }) })
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
  beginFeatureEdit(e) { const item = this.data.features.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id)); if (item) this.setData({ form: Object.assign({ kind: 'feature' }, item) }) },
  beginFeatureCreate() { this.setData({ form: { kind: 'feature', configKey: '', label: '', configValue: '', status: 1 } }) },

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
    const label = action === 'approve' ? '通过并发起微信零钱转账' : '驳回提现申请'
    if (!await this.confirm(label, '该操作将记录在资金审核日志中。')) return
    try { await admin.reviewWithdrawal(id, action); wx.showToast({ title: action === 'approve' ? '已发起转账' : '已驳回', icon: 'success' }); this.loadWithdrawals() } catch (e) {}
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

  // ===== 操作日志 =====
  onLogActionInput(e) { this.setData({ logAction: e.detail.value }) },
  searchLogs() { this.loadLogs(1) },
  async loadLogs(page) {
    if (this.data.logsLoading) return
    this.setData({ logsLoading: true })
    try {
      const data = await admin.auditLogs({ page: page || 1, pageSize: 20, action: this.data.logAction })
      const list = data.list || []
      this.setData({
        logs: (page || 1) <= 1 ? list : this.data.logs.concat(list),
        logsPage: page || 1,
        logsHasMore: !!data.hasMore
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '日志加载失败', icon: 'none' })
    } finally {
      this.setData({ logsLoading: false })
    }
  },
  loadMoreLogs() { if (this.data.logsHasMore) this.loadLogs(this.data.logsPage + 1) },

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
        if (form.type === 'banner' || form.type === 'notice') payload.body = JSON.stringify(form.meta || {})
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
      if (form.kind === 'feature') await admin.saveFeature(form)
      if (form.kind === 'item') form.id ? await admin.updateItem(form.id, form) : await admin.createItem(form)
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
