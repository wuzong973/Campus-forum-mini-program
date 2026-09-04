const admin = require('../../utils/admin')
const { runPullDownRefresh } = require('../../utils/refresh')

const TAB_PERMISSIONS = {
  overview: 'stats.view',
  reports: 'content.manage',
  posts: 'content.manage',
  content: 'config.manage',
  items: 'item.manage',
  users: 'user.manage',
  withdrawals: 'payment.manage',
  riderVerifications: 'user.manage'
}

Page({
  data: {
    ready: false,
    role: '',
    permissions: [],
    activeTab: 'overview',
    tabs: [],
    stats: null,
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
      const tabs = [
        { key: 'overview', name: '概览' },
        { key: 'reports', name: '举报' },
        { key: 'posts', name: '帖子' },
        { key: 'content', name: '配置' },
        { key: 'items', name: '物品' },
        { key: 'users', name: '用户' },
        { key: 'withdrawals', name: '提现审核' },
        { key: 'riderVerifications', name: '认证审核' }
      ].filter((tab) => this.can(access.permissions || [], TAB_PERMISSIONS[tab.key]))
      if (!tabs.length) throw new Error('无可用管理权限')
      this.setData({ ready: true, role: access.role, permissions: access.permissions || [], tabs, activeTab: tabs[0].key })
      this.loadCurrent()
    } catch (e) {
      wx.showModal({ title: '无法访问', content: '当前账号没有管理员权限或权限已变更。', showCancel: false, complete: () => wx.navigateBack() })
    }
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, this.loadCurrent)
  },

  can(permissions, permission) {
    return permissions.indexOf('*') >= 0 || permissions.indexOf(permission) >= 0
  },

  async loadCurrent() {
    const tab = this.data.activeTab
    try {
      if (tab === 'overview') this.setData({ stats: await admin.stats() })
      if (tab === 'reports') await this.loadReports()
      if (tab === 'posts') await this.loadPosts()
      if (tab === 'content') await this.loadContent()
      if (tab === 'items') this.setData({ items: (await admin.items()).list || [] })
      if (tab === 'users') await this.loadUsers()
      if (tab === 'withdrawals') await this.loadWithdrawals()
      if (tab === 'riderVerifications') await this.loadRiderVerifications()
    } catch (e) {}
  },

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
  beginContentCreate() { this.setData({ form: { kind: 'content', type: this.data.contentType, title: '', body: '', status: 1, sortOrder: 0 } }) },
  beginContentEdit(e) { const item = this.data.contentList.find((row) => Number(row.id) === Number(e.currentTarget.dataset.id)); if (item) this.setData({ form: Object.assign({ kind: 'content' }, item) }) },
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
  changeRole(e) { const id = Number(e.currentTarget.dataset.id); wx.showActionSheet({ itemList: ['普通用户', '内容管理员', '用户管理员', '运营管理员', '超级管理员'], success: async (res) => { const role = ['user', 'content_admin', 'user_admin', 'operator', 'super_admin'][res.tapIndex]; if (!await this.confirm('修改角色', '角色变更会立即改变该账号的管理范围。')) return; try { await admin.updateUserRole(id, role); this.loadUsers() } catch (err) {} } }) },

  formInput(e) { const key = e.currentTarget.dataset.key; this.setData({ ['form.' + key]: e.detail.value }) },
  formStatus(e) { this.setData({ 'form.status': e.detail.value ? 1 : 0 }) },
  closeForm() { this.setData({ form: null }) },
  async saveForm() {
    const form = this.data.form; if (!form || this.data.saving) return
    this.setData({ saving: true })
    try {
      if (form.kind === 'post') await admin.updatePost(form.id, form)
      if (form.kind === 'content') form.id ? await admin.updateContent(form.id, form) : await admin.createContent(form)
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

  noop() {},

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
