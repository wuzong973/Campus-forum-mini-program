// 管理后台独立编辑页（取代原 pkg-admin/admin/index 的抽屉表单）
//
// 设计：scope 驱动 —— 一个页面承载全部 13 种编辑表单（+3 种审核动作），
// 用 URL 参数 ?scope=<kind> 决定渲染哪一块 WXML、以及保存时调哪个接口。
// 保存成功后自动 navigateBack，并通过 app.globalData.adminEditDone 通知后台列表 onShow 刷新。
//
// ⚠ 迁移纪律：原 pkg-admin/admin/index.js 的 saveForm 里有逐 kind 的字段校验（约 215 行），
// 本页 buildPayload() 必须**逐条保留**，否则会出现「以前拦得住的脏数据现在能存进去」。
// 每个校验失败都用 wx.showToast + return false 立即中止。

const admin = require('../../utils/admin')
const wechat = require('../../../utils/wechat')
// 可跳转链接的统一判定（与 server/utils/link.js 同规则）
const link = require('../../../utils/link')
// 可跳转页面清单：后台让运营「选页面」而不是「手打路径」
const pageList = require('../../../utils/page-list')
const meta = require('../../utils/admin-edit-meta')

const {
  CAMPUS_SELECT_OPTIONS,
  JOIN_MODE_OPTIONS,
  JOIN_MODE_LABELS,
  DEFAULT_JOIN_MODE,
  MAX_MEMBER_COUNT,
  CONTENT_FORM_META,
  BANNER_STYLE_VALUES,
  BANNER_STYLE_NAMES,
  BANNER_STYLE_BG,
  BANNER_STYLE_FG,
  GC_CATEGORIES,
  DRIVING_SCHOOL_CAMPUS_OPTIONS,
  DRIVING_SCHOOL_LEVEL_OPTIONS,
  PUSH_GROUP_THEME_KEYS,
  PUSH_GROUP_THEME_OPTIONS,
  fmtDateTime,
  normalizeHex,
  parseContentMeta,
  emptyContentMeta,
  buildSchoolPayload
} = meta

// 各 scope 的页面标题（新建/编辑分别取不同文案）
const SCOPE_TITLES = {
  post: { edit: '编辑帖子' },
  content: { create: '新增', edit: '编辑' },
  item: { create: '虚拟物品', edit: '虚拟物品' },
  service: { create: '新增服务', edit: '编辑服务' },
  drivingSchool: { create: '新增驾校', edit: '编辑驾校' },
  pushGroup: { create: '新增卡片', edit: '编辑卡片' },
  chatGroup: { create: '添加群聊', edit: '编辑群聊' },
  gcCategory: { create: '新增群聊类别', edit: '编辑群聊类别' },
  club: { create: '添加社团', edit: '编辑社团' },
  clubCategory: { create: '新增社团分类', edit: '编辑社团分类' },
  activity: { edit: '编辑活动' },
  chatReview: { approve: '通过建群申请', reject: '驳回建群申请' },
  clubReview: { approve: '通过社团申请', reject: '驳回社团申请' },
  activityAudit: { edit: '驳回活动' }
}

// 各 scope 保存成功后要通知后台列表刷新的 key（后台 loadCurrent 无关，直接用 scope 做一次全量 loadCurrent 即可）
const SCOPES_WITH_STATUS_SWITCH = [
  'item', 'content', 'service', 'drivingSchool', 'pushGroup', 'chatGroup',
  'gcCategory', 'club', 'clubCategory', 'activity'
]

Page({
  data: {
    scope: '',
    id: 0,
    editingId: 0,          // 新建时为 0
    pageTitle: '编辑',
    formTitle: '编辑',
    saveLabel: '保存并发布',
    saving: false,
    loaded: false,
    loadError: '',
    form: {},

    // 选项 / 文案（WXML 用）
    campusOptions: CAMPUS_SELECT_OPTIONS,
    joinModeLabels: JOIN_MODE_LABELS,
    styleNames: BANNER_STYLE_NAMES,
    styleBg: BANNER_STYLE_BG,
    styleFg: BANNER_STYLE_FG,
    pushGroupThemeOptions: PUSH_GROUP_THEME_OPTIONS,
    drivingSchoolCampusOptions: DRIVING_SCHOOL_CAMPUS_OPTIONS,
    drivingSchoolLevelOptions: DRIVING_SCHOOL_LEVEL_OPTIONS,
    contentFormTitle: '',
    contentFormGuide: '',
    // 跳转路径的「选页面 / 选帖子 / 手动输入」三模式全在 components/link-picker 里，
    // 各入口只接它的 change 事件，不再各自维护一份状态（曾经各写一份，行为必然分叉）。
    // 下拉数据源（编辑页自己拉，不依赖后台列表已在内存里）
    serviceCategoryNames: [],
    clubCategoryNames: [],
    chatCategoryNames: GC_CATEGORIES,
    // 审核动作
    reviewAction: '',
    applyName: '',
    activityTitle: '',
    // 颜色选择器
    colorPickerShow: false,
    colorPickerValue: '',
    colorPickerTitle: '',
    _colorField: '',
    _colorScope: 'meta'    // meta | self
  },

  onLoad(options) {
    const scope = String((options && options.scope) || '')
    const id = Number((options && options.id) || 0)
    const action = String((options && options.action) || '')
    const type = String((options && options.type) || '')
    this._options = options || {}
    this._reviewAction = action
    if (!scope) {
      wx.showToast({ title: '缺少编辑类型', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({ scope, id, editingId: id, reviewAction: action, saveLabel: this._saveLabel(scope, id) })
    this._type = type
    this._applyTitle(scope, id, action, type)
    this.loadForm(scope, id, action, type)
  },

  // 保存按钮文案（群聊新建=创建群聊，审核=确认通过/确认驳回，其余=保存并发布）
  _saveLabel(scope, id) {
    if (scope === 'chatReview' || scope === 'clubReview') {
      return this._reviewAction === 'approve' ? '确认通过' : '确认驳回'
    }
    if (scope === 'activityAudit') return '确认驳回'
    if (scope === 'chatGroup') return id ? '保存修改' : '创建群聊'
    return '保存并发布'
  },

  _applyTitle(scope, id, action, type) {
    const conf = SCOPE_TITLES[scope] || { edit: '编辑' }
    let title = conf.edit || '编辑'
    if (!id && conf.create) title = conf.create
    if (scope === 'content') title = (id ? '编辑' : '新增') + (CONTENT_FORM_META[type] ? CONTENT_FORM_META[type].title : '内容')
    if (scope === 'chatReview' || scope === 'clubReview') title = action === 'approve' ? '通过申请' : '驳回申请'
    wx.setNavigationBarTitle({ title })
    this.setData({ pageTitle: title, formTitle: title })
  },

  // ===== 加载：把台账数据从接口取回来填入 form =====
  async loadForm(scope, id, action, type) {
    try {
      if (scope === 'content') await this._loadContentForm(id, type)
      else if (scope === 'item') await this._loadItemForm(id)
      else if (scope === 'service') await this._loadServiceForm(id)
      else if (scope === 'drivingSchool') await this._loadDrivingSchoolForm(id)
      else if (scope === 'pushGroup') await this._loadPushGroupForm(id)
      else if (scope === 'chatGroup') await this._loadChatGroupForm(id)
      else if (scope === 'gcCategory') await this._loadGcCategoryForm(id)
      else if (scope === 'clubCategory') await this._loadClubCategoryForm(id)
      else if (scope === 'club') await this._loadClubForm(id)
      else if (scope === 'activity') await this._loadActivityForm(id)
      else if (scope === 'post') await this._loadPostForm(id)
      else if (scope === 'chatReview') await this._loadChatReviewForm(id, action)
      else if (scope === 'clubReview') await this._loadClubReviewForm(id, action)
      else if (scope === 'activityAudit') await this._loadActivityAuditForm(id)
      else throw new Error('未知的编辑类型：' + scope)
      this.setData({ loaded: true })
      // 记录初始快照，用于「未保存就返回」的二次确认
      this._snapshot = JSON.stringify(this.data.form)
    } catch (e) {
      const msg = (e && e.message) || '加载失败'
      this.setData({ loaded: true, loadError: msg })
      wx.showToast({ title: msg, icon: 'none' })
    }
  },

  async _loadContentForm(id, type) {
    const info = CONTENT_FORM_META[type] || { title: '内容', guide: '' }
    let form
    if (!id) {
      form = Object.assign({ kind: 'content', type, title: '', body: '', status: 1, sortOrder: 0 }, { meta: emptyContentMeta(type) })
    } else {
      const data = await admin.content(type)
      const item = (data.list || []).find((row) => Number(row.id) === Number(id))
      if (!item) throw new Error('内容不存在或已被删除')
      const m = parseContentMeta(item.type, item.body)
      const body = item.type === 'tag' ? (m.text || '') : (item.body || '')
      form = Object.assign({ kind: 'content' }, item, { body, meta: m })
    }
    // 跳转路径的回显交给 components/link-picker 自己处理（它按 value 判断该落在哪个模式），
    // 这里只要把 form 塞进 data 即可。
    this.setData({ form, contentFormTitle: info.title, contentFormGuide: info.guide })
  },

  async _loadItemForm(id) {
    if (!id) {
      this.setData({ form: { kind: 'item', name: '', description: '', coverUrl: '', price: '', stock: 0, status: 1 } })
      return
    }
    const data = await admin.items()
    const item = ((data && data.list) || []).find((row) => Number(row.id) === Number(id))
    if (!item) throw new Error('物品不存在或已被删除')
    this.setData({ form: Object.assign({ kind: 'item' }, item) })
  },

  async _loadServiceForm(id) {
    const data = await admin.services()
    const categories = data.categories || []
    this.setData({ serviceCategoryNames: categories.map((c) => c.name) })
    if (!id) {
      if (!categories.length) throw new Error('请先在配置里添加服务分类')
      this.setData({ form: { kind: 'service', categoryIndex: 0, categoryId: categories[0].id, name: '', icon: '', iconPath: '', badge: '', link: '', miniAppId: '', sortOrder: 0, status: 1 } })
      return
    }
    const row = (data.list || []).find((r) => Number(r.id) === Number(id))
    if (!row) throw new Error('服务不存在或已被删除')
    const idx = categories.findIndex((c) => Number(c.id) === Number(row.categoryId))
    this._serviceCategories = categories
    this.setData({ form: Object.assign({ kind: 'service', categoryIndex: idx < 0 ? 0 : idx }, row) })
  },

  async _loadDrivingSchoolForm(id) {
    if (!id) {
      const campus = DRIVING_SCHOOL_CAMPUS_OPTIONS[0]
      this.setData({
        form: {
          kind: 'drivingSchool', name: '', campus, campusIndex: 0, region: '', address: '', phone: '',
          carTypes: 'C1 C2', price: '', intro: '', passRate: '', level: 'A', levelIndex: 1,
          tags: '', distanceKm: '', cover: '', images: [], detail: '', sortOrder: 0, status: 1, lat: 0, lng: 0, contactQr: '', contactName: ''
        }
      })
      return
    }
    const data = await admin.drivingSchools()
    const row = ((data && data.list) || []).find((r) => Number(r.id) === Number(id))
    if (!row) throw new Error('驾校不存在或已被删除')
    this.setData({
      form: Object.assign({ kind: 'drivingSchool' }, row, {
        campusIndex: Math.max(0, DRIVING_SCHOOL_CAMPUS_OPTIONS.indexOf(row.campus)),
        levelIndex: Math.max(0, DRIVING_SCHOOL_LEVEL_OPTIONS.indexOf(row.level)),
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

  async _loadPushGroupForm(id) {
    if (!id) {
      this.setData({ form: { kind: 'pushGroup', title: '', desc: '', content: '', images: [], icon: '', iconPath: '', theme: 'blue', themeIndex: 2, link: '', copyText: '', sortOrder: 0, status: true } })
      return
    }
    const list = await admin.pushGroups()
    const row = (list || []).find((r) => Number(r.id) === Number(id))
    if (!row) throw new Error('卡片不存在或已被删除')
    this.setData({
      form: Object.assign({ kind: 'pushGroup' }, row, {
        content: row.content || '',
        images: Array.isArray(row.images) ? row.images.slice() : [],
        iconPath: row.iconPath || '',
        themeIndex: Math.max(0, PUSH_GROUP_THEME_KEYS.indexOf(row.theme)),
        sortOrder: String(row.sortOrder || 0),
        status: !!row.status
      })
    })
  },

  async _loadChatGroupForm(id) {
    // 群类别：编辑页自行拉取（不依赖后台列表状态）
    let categories = []
    try {
      const gc = await admin.groupChatCategories()
      const names = ((gc && gc.list) || []).map((row) => row.name).filter(Boolean)
      categories = names.length ? names : GC_CATEGORIES.slice()
    } catch (e) { categories = GC_CATEGORIES.slice() }
    this.setData({ chatCategoryNames: categories })

    if (!id) {
      this.setData({
        form: {
          kind: 'chatGroup', id: 0, name: '', categoryIndex: 0, intro: '', notice: '', ownerName: '',
          memberCount: '', joinModeIndex: 0, needAudit: 0,
          meta: { avatarUrl: '', qrcodeUrl: '', gzhQrcodeUrl: '', images: [] },
          isOfficial: 0, customTag: '', campus: '', sortOrder: 0, status: 1
        }
      })
      return
    }
    const data = await admin.groupChatGroups({ page: 1, pageSize: 200 })
    const group = ((data && data.list) || []).find((row) => Number(row.id) === Number(id))
    if (!group) throw new Error('群聊不存在或已被删除')
    const categoryIndex = Math.max(0, categories.indexOf(group.category || ''))
    const joinModeIndex = Math.max(0, JOIN_MODE_OPTIONS.findIndex((item) => item.value === (group.joinMode || DEFAULT_JOIN_MODE)))
    const memberCount = Number(group.memberCount) || 0
    this.setData({
      form: {
        kind: 'chatGroup', id: group.id, name: group.name || '', categoryIndex,
        intro: group.intro || '', notice: group.notice || '', ownerName: group.ownerName || '',
        memberCount: memberCount > 0 ? String(memberCount) : '',
        joinModeIndex, needAudit: group.needAudit ? 1 : 0,
        meta: { avatarUrl: group.avatarUrl || '', qrcodeUrl: group.qrcodeUrl || '', gzhQrcodeUrl: group.gzhQrcodeUrl || '', images: Array.isArray(group.images) ? group.images : [] },
        isOfficial: group.isOfficial ? 1 : 0, customTag: group.customTag || '', campus: group.campus || '',
        sortOrder: group.sortOrder || 0, status: group.status ? 1 : 0
      }
    })
  },

  async _loadGcCategoryForm(id) {
    if (!id) {
      this.setData({ form: { kind: 'gcCategory', id: 0, name: '', description: '', sortOrder: 0, status: 1 } })
      return
    }
    const gc = await admin.groupChatCategories()
    const category = ((gc && gc.list) || []).find((row) => Number(row.id) === Number(id))
    if (!category) throw new Error('群聊类别不存在或已被删除')
    this.setData({ form: { kind: 'gcCategory', id: category.id, name: category.name || '', description: category.description || '', sortOrder: category.sortOrder || 0, status: category.status ? 1 : 0 } })
  },

  async _loadClubCategoryForm(id) {
    const data = await admin.clubCategories()
    const list = data.list || []
    this.setData({ clubCategoryNames: list.map((row) => row.name) })
    if (!id) {
      this.setData({ form: { kind: 'clubCategory', id: 0, name: '', iconChar: '', slogan: '', meta: { color: '#2E6BFF' }, position: '', scopeIntro: '', scopeText: '', featuresText: '', contact: '', sortOrder: 0, status: 1 } })
      return
    }
    const category = list.find((row) => Number(row.id) === Number(id))
    if (!category) throw new Error('社团分类不存在或已被删除')
    this.setData({
      form: {
        kind: 'clubCategory', id: category.id, name: category.name || '', iconChar: category.iconChar || '',
        slogan: category.slogan || '', meta: { color: category.color || '#2E6BFF' },
        position: category.position || '', scopeIntro: category.scopeIntro || '',
        scopeText: (Array.isArray(category.scope) ? category.scope : []).join('、'),
        featuresText: (Array.isArray(category.features) ? category.features : []).map((item) => item.title + '|' + item.desc).join('\n'),
        contact: category.contact || '', sortOrder: category.sortOrder || 0, status: category.status ? 1 : 0
      }
    })
  },

  async _loadClubForm(id) {
    const data = await admin.clubCategories()
    const categories = data.list || []
    this._clubCategories = categories
    this.setData({ clubCategoryNames: categories.map((row) => row.name) })
    if (!id) {
      const categoryId = Number((this._options && this._options.categoryId) || 0)
      const index = categories.findIndex((row) => Number(row.id) === categoryId)
      this.setData({ form: { kind: 'club', id: 0, categoryId, categoryIndex: Math.max(0, index), clubType: '学生社团', name: '', tags: '', intro: '', recruit: '', campus: '', sortOrder: 0, status: 1, meta: { avatarUrl: '', qrcodeUrl: '', adminQrcodeUrl: '', gzhQrcodeUrl: '', images: [] } } })
      return
    }
    let club = null
    let category = null
    for (const cat of categories) {
      const found = (cat.clubs || []).find((row) => Number(row.id) === Number(id))
      if (found) { club = found; category = cat; break }
    }
    if (!club) throw new Error('社团不存在或已被删除')
    const index = categories.findIndex((row) => row.id === (category || {}).id)
    this.setData({
      form: {
        kind: 'club', id: club.id, categoryId: (category || {}).id || 0, categoryIndex: Math.max(0, index),
        clubType: club.clubType || '学生社团', name: club.name || '', tags: club.tags || '', intro: club.intro || '',
        recruit: club.recruit || '', campus: club.campus || '', sortOrder: club.sortOrder || 0, status: club.status ? 1 : 0,
        meta: { avatarUrl: club.avatarUrl || '', qrcodeUrl: club.qrcodeUrl || '', adminQrcodeUrl: club.adminQrcodeUrl || '', gzhQrcodeUrl: club.gzhQrcodeUrl || '', images: Array.isArray(club.images) ? club.images : [] }
      }
    })
  },

  async _loadActivityForm(id) {
    if (!id) throw new Error('缺少活动 ID')
    const data = await admin.activities()
    const list = (data && data.list) || []
    const activity = list.find((row) => Number(row.id) === Number(id))
    if (!activity) throw new Error('活动不存在或已被删除')
    this.setData({
      form: {
        kind: 'activity', id: activity.id, title: activity.title || '',
        signupStart: fmtDateTime(activity.signupStart).slice(0, 16),
        signupEnd: fmtDateTime(activity.signupEnd).slice(0, 16),
        activityStart: fmtDateTime(activity.activityStart).slice(0, 16),
        activityEnd: fmtDateTime(activity.activityEnd).slice(0, 16),
        location: activity.location || '', address: activity.address || '', campus: activity.campus || '',
        capacity: activity.capacity || 0,
        meta: { coverUrl: activity.coverUrl || '', images: Array.isArray(activity.images) ? activity.images : [] },
        detailTitle: activity.detailTitle || '', detailContent: activity.detailContent || '',
        signupTitle: activity.signupTitle || '', signupContent: activity.signupContent || '',
        status: activity.status ? 1 : 0
      }
    })
  },

  async _loadPostForm(id) {
    if (!id) throw new Error('缺少帖子 ID')
    const data = await admin.posts({ page: 1, pageSize: 200 })
    const post = ((data && data.list) || []).find((item) => Number(item.id) === Number(id))
    if (!post) throw new Error('帖子不存在或已被删除')
    this.setData({ form: { kind: 'post', id: post.id, title: post.title || '', content: post.content || '', category: post.category || '' } })
  },

  async _loadChatReviewForm(id, action) {
    if (!id) throw new Error('缺少申请 ID')
    const data = await admin.groupChatApplies({ page: 1, pageSize: 200 })
    const apply = ((data && data.list) || []).find((row) => Number(row.id) === Number(id))
    if (!apply) throw new Error('申请不存在或已被处理')
    this.setData({ applyName: apply.name, form: { kind: 'chatReview', id, action, applyName: apply.name, reviewNote: '' } })
  },

  async _loadClubReviewForm(id, action) {
    if (!id) throw new Error('缺少申请 ID')
    const data = await admin.clubApplies({ page: 1, pageSize: 200, status: 'pending' })
    const apply = ((data && data.list) || []).find((row) => Number(row.id) === Number(id))
    if (!apply) throw new Error('申请不存在或已被处理')
    this.setData({ applyName: apply.name, form: { kind: 'clubReview', id, action, applyName: apply.name, reviewNote: '' } })
  },

  async _loadActivityAuditForm(id) {
    if (!id) throw new Error('缺少活动 ID')
    const data = await admin.activityAudits({ page: 1, pageSize: 200, status: 'pending' })
    const item = ((data && data.list) || []).find((row) => Number(row.id) === Number(id))
    if (!item) throw new Error('活动不存在或已被处理')
    this.setData({ activityTitle: item.title, form: { kind: 'activityAudit', id, reviewNote: '' } })
  },

  // ===== 通用输入 =====
  formInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ ['form.' + key]: e.detail.value })
  },
  formStatus(e) { this.setData({ 'form.status': e.detail.value ? 1 : 0 }) },
  formNeedAudit(e) { this.setData({ 'form.needAudit': e.detail.value ? 1 : 0 }) },
  formOfficial(e) { this.setData({ 'form.isOfficial': e.detail.value ? 1 : 0 }) },
  onFormCampus(e) { this.setData({ 'form.campus': e.currentTarget.dataset.value || '' }) },

  onFormStyleChange(e) {
    const index = Number(e.detail.value) || 0
    this.setData({ 'form.meta.styleIndex': index, 'form.meta.style': BANNER_STYLE_VALUES[index] })
  },

  // ===== 跳转路径 =====
  // 选页面 / 选帖子 / 手动输入 三模式全在 components/link-picker 里，
  // 各入口只负责把组件回传的路径写进自己的表单字段 —— 这样五处跳转配置
  // （首页轮播 / 发布横幅 / 公告右侧链接 / 推送群卡片 / 自定义页面）行为完全一致。
  onLinkPicked(e) {
    this.setData({ 'form.meta.link': (e.detail && e.detail.value) || '' })
  },

  onNoticeLinkPicked(e) {
    this.setData({ 'form.meta.linkUrl': (e.detail && e.detail.value) || '' })
  },

  onPublishBannerLinkPicked(e) {
    this.setData({ 'form.meta.link': (e.detail && e.detail.value) || '' })
  },

  onPushGroupLinkPicked(e) {
    this.setData({ 'form.link': (e.detail && e.detail.value) || '' })
  },

  onServiceCategoryChange(e) {
    const idx = Number(e.detail.value)
    const cats = this._serviceCategories || []
    const cat = cats[idx]
    this.setData({ 'form.categoryIndex': idx, 'form.categoryId': cat ? cat.id : 0 })
  },
  onPushGroupThemeChange(e) {
    const idx = Number(e.detail.value) || 0
    const key = PUSH_GROUP_THEME_KEYS[idx] || 'blue'
    this.setData({ 'form.themeIndex': idx, 'form.theme': key })
  },
  onPushGroupStatusChange(e) { this.setData({ 'form.status': e.detail.value }) },
  onDrivingSchoolCampusChange(e) {
    const idx = Number(e.detail.value) || 0
    const campus = DRIVING_SCHOOL_CAMPUS_OPTIONS[idx]
    if (!campus) return
    this.setData({ 'form.campusIndex': idx, 'form.campus': campus })
  },
  onDrivingSchoolLevelChange(e) {
    const idx = Number(e.detail.value) || 0
    const level = DRIVING_SCHOOL_LEVEL_OPTIONS[idx]
    if (!level) return
    this.setData({ 'form.levelIndex': idx, 'form.level': level })
  },
  onChatCategoryChange(e) { this.setData({ 'form.categoryIndex': Number(e.detail.value) || 0 }) },
  onChatJoinModeChange(e) { this.setData({ 'form.joinModeIndex': Number(e.detail.value) || 0 }) },
  onClubCategoryChange(e) {
    const index = Number(e.detail.value) || 0
    const name = this.data.clubCategoryNames[index]
    // 分类用名称在选项里，但要回填 categoryId —— 与后台列表一致的实现依赖 clubCategories
    const list = this._clubCategories || []
    const category = list.find((row) => row.name === name)
    this.setData({ 'form.categoryIndex': index, 'form.categoryId': category ? category.id : 0 })
  },

  // ===== 图片上传 =====
  // pushGroup 表单是扁平的（form.iconPath），其余挂在 form.meta.* 下
  chooseFormImage(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const flat = this.data.scope === 'pushGroup'
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages([file.tempFilePath]).then((urls) => {
          wx.hideLoading()
          const url = (urls || [])[0]
          if (!url || !/^https:\/\//.test(url)) throw new Error('upload failed')
          this.setData(flat ? { ['form.' + key]: url } : { ['form.meta.' + key]: url })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        })
      }
    })
  },
  clearFormImage(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const flat = this.data.scope === 'pushGroup'
    this.setData(flat ? { ['form.' + key]: '' } : { ['form.meta.' + key]: '' })
  },

  // 多图上传（社团/群聊/活动 的 meta.images；驾校/推送群 的扁平 form.images）
  addImages(e) {
    const scope = this.data.scope
    const max = Number(e.currentTarget.dataset.max) || 5
    const flat = scope === 'drivingSchool' || scope === 'pushGroup' || scope === 'activity'
    const current = flat ? (this.data.form.images || []) : ((this.data.form.meta && this.data.form.meta.images) || [])
    const remain = max - current.length
    if (remain <= 0) { wx.showToast({ title: '最多上传 ' + max + ' 张图片', icon: 'none' }); return }
    wx.chooseMedia({
      count: remain, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
        if (!paths.length) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages(paths).then((urls) => {
          wx.hideLoading()
          const valid = (urls || []).filter((url) => /^https:\/\//.test(url))
          if (!valid.length) throw new Error('upload failed')
          const next = current.concat(valid).slice(0, max)
          // 活动表单的图片在 meta.images 下，驾校/推送群在扁平 images 下
          if (flat) this.setData({ 'form.images': next })
          else this.setData({ 'form.meta.images': next })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        })
      }
    })
  },
  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const scope = this.data.scope
    const flat = scope === 'drivingSchool' || scope === 'pushGroup' || scope === 'activity'
    const current = flat ? ((this.data.form.images) || []).slice() : (((this.data.form.meta && this.data.form.meta.images) || [])).slice()
    if (index < 0 || index >= current.length) return
    current.splice(index, 1)
    if (flat) this.setData({ 'form.images': current })
    else this.setData({ 'form.meta.images': current })
  },
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    const scope = this.data.scope
    const flat = scope === 'drivingSchool' || scope === 'pushGroup' || scope === 'activity'
    const images = (flat ? (this.data.form.images || []) : ((this.data.form.meta && this.data.form.meta.images) || []))
    if (url) wx.previewImage({ urls: images.length ? images : [url], current: url })
  },

  // 驾校专用：封面 / 二维码 / 坐标
  chooseSchoolCover() { this._chooseSingle('form.cover', '封面上传失败，请重试') },
  clearSchoolCover() { this.setData({ 'form.cover': '' }) },
  chooseSchoolQr() { this._chooseSingle('form.contactQr', '二维码上传失败，请重试', 'original') },
  clearSchoolQr() { this.setData({ 'form.contactQr': '' }) },
  _chooseSingle(path, errTip, sizeType) {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: [sizeType || 'compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file || !file.tempFilePath) return
        wx.showLoading({ title: '上传中...', mask: true })
        wechat.uploadImages([file.tempFilePath]).then((urls) => {
          wx.hideLoading()
          const url = (urls || [])[0]
          if (!url || !/^https:\/\//.test(url)) throw new Error('upload failed')
          this.setData({ [path]: url })
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: errTip, icon: 'none' })
        })
      }
    })
  },
  chooseSchoolLocation() {
    wx.chooseLocation({
      success: (res) => {
        const lat = Number(res.latitude)
        const lng = Number(res.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) {
          wx.showToast({ title: '未取到坐标，请重试', icon: 'none' }); return
        }
        const round = (n) => Math.round(n * 1e6) / 1e6
        this.setData({ 'form.lat': round(lat), 'form.lng': round(lng) })
        const picked = String(res.name || res.address || '').trim()
        if (picked && !String(this.data.form.address || '').trim()) this.setData({ 'form.address': picked })
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

  // ===== 颜色选择器 =====
  // data-field 指定 meta 里的字段；社团分类主题色直接写 form.meta.color，同一条路径
  openContentColorPicker(e) {
    const allowed = ['textColor', 'accent', 'bgColor', 'color']
    const field = allowed.indexOf(e.currentTarget.dataset.field) >= 0 ? e.currentTarget.dataset.field : 'bgColor'
    const titles = { bgColor: '选择背景颜色', textColor: '选择文字颜色', accent: '选择主题色', color: '选择主题色' }
    this.setData({
      _colorField: field,
      colorPickerValue: ((this.data.form && this.data.form.meta) || {})[field] || '',
      colorPickerTitle: titles[field],
      colorPickerShow: true
    })
  },
  onColorPickerClose() { this.setData({ colorPickerShow: false }) },
  onColorPickerConfirm(e) {
    const hex = normalizeHex(e.detail && e.detail.hex)
    const field = this.data._colorField
    if (field) this.setData({ ['form.meta.' + field]: hex, colorPickerShow: false })
    else this.setData({ colorPickerShow: false })
  },

  // ===== 取消 / 返回（未保存修改拦截） =====
  onCancel() {
    if (this.data.saving) return
    this._confirmLeave(() => wx.navigateBack())
  },
  _confirmLeave(done) {
    const snapshot = this._snapshot
    if (snapshot && JSON.stringify(this.data.form) !== snapshot) {
      wx.showModal({
        title: '放弃修改',
        content: '表单中有未保存的修改，返回后将会丢失。确定返回吗？',
        confirmText: '放弃并返回',
        cancelText: '继续编辑',
        success: (res) => { if (res.confirm) done() }
      })
      return
    }
    done()
  },
  // 记录初始快照（loadForm 成功后调用）
  _saveSnapshot() { this._snapshot = JSON.stringify(this.data.form) },
  // ===== 保存 =====
  // 返回 true 表示校验通过且已提交；false 表示被校验拦下（调用方不要返回）
  async buildPayload() {
    const form = this.data.form
    const scope = this.data.scope
    const toast = (title) => { wx.showToast({ title, icon: 'none' }); return false }

    if (scope === 'post') {
      await admin.updatePost(form.id, form)
      return true
    }

    if (scope === 'content') {
      // 首页轮播的跳转路径先归一化（去 .html / 补分包前缀 / 去站点域名 / 补斜杠），
      // 校验与落库都用修正后的值 —— 运营不必记格式规则，改了什么也会在表单里提示。
      if (form.type === 'banner') {
        const fixed = link.normalizePagePath(form.meta && form.meta.link)
        if (fixed.changed) form.meta.link = fixed.value
      }
      const payload = Object.assign({}, form)
      if (form.type === 'banner' || form.type === 'notice' || form.type === 'publish_banner') payload.body = JSON.stringify(form.meta || {})
      if (form.type === 'tag') payload.body = JSON.stringify({ text: String(form.body || ''), bgColor: form.meta.bgColor || '', textColor: form.meta.textColor || '' })
      if (form.type === 'banner' && (!String(form.title || '').trim() || !(form.meta && form.meta.image))) return toast('请填写标题并上传轮播图片')
      if (form.type === 'notice' && !String(form.title || '').trim()) return toast('请填写公告文字')
      // 首页轮播的跳转链接：先查格式（#小程序:// 短链、javascript: 等），再查页面是否真的存在。
      // 用 showModal 而不是 showToast：原因较长，toast 会截断。
      if (form.type === 'banner') {
        const value = form.meta && form.meta.link
        const reason = link.linkRejectReason(value) || pageList.pageExistenceReason(value)
        if (reason) {
          wx.showModal({ title: '跳转链接不可用', content: reason, showCancel: false, confirmText: '知道了' })
          return false
        }
      }
      form.id ? await admin.updateContent(form.id, payload) : await admin.createContent(payload)
      return true
    }

    if (scope === 'item') {
      form.id ? await admin.updateItem(form.id, form) : await admin.createItem(form)
      return true
    }

    if (scope === 'service') {
      if (!String(form.name || '').trim()) return toast('请填写服务名称')
      if (!form.categoryId) return toast('请选择所属分类')
      const payload = { categoryId: form.categoryId, name: String(form.name).trim(), icon: String(form.icon || '').trim(), iconPath: String(form.iconPath || '').trim(), badge: String(form.badge || '').trim(), link: String(form.link || '').trim(), miniAppId: String(form.miniAppId || '').trim(), sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
      form.id ? await admin.updateService(form.id, payload) : await admin.createService(payload)
      return true
    }

    if (scope === 'drivingSchool') {
      if (!String(form.name || '').trim()) return toast('请填写驾校名称')
      const payload = buildSchoolPayload(form, DRIVING_SCHOOL_CAMPUS_OPTIONS[0])
      form.id ? await admin.updateDrivingSchool(form.id, payload) : await admin.createDrivingSchool(payload)
      return true
    }

    if (scope === 'pushGroup') {
      if (!String(form.title || '').trim()) return toast('请填写卡片标题')
      const payload = {
        title: String(form.title).trim(),
        desc: String(form.desc || '').trim(),
        content: String(form.content || '').trim(),
        images: Array.isArray(form.images) ? form.images.slice(0, 3) : [],
        icon: String(form.icon || '').trim(),
        iconPath: String(form.iconPath || '').trim(),
        theme: form.theme || 'blue',
        link: String(form.link || '').trim(),
        copyText: String(form.copyText || '').trim(),
        sortOrder: Number(form.sortOrder) || 0,
        status: form.status ? 1 : 0
      }
      form.id ? await admin.savePushGroup(form.id, payload) : await admin.createPushGroup(payload)
      return true
    }

    if (scope === 'gcCategory') {
      if (!String(form.name || '').trim()) return toast('请填写类别名称')
      const payload = { name: String(form.name).trim(), description: String(form.description || '').trim(), sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
      form.id ? await admin.updateGroupChatCategory(form.id, payload) : await admin.createGroupChatCategory(payload)
      return true
    }

    if (scope === 'chatGroup') {
      const name = String(form.name || '').trim()
      if (!name) return toast('请填写群聊名称')
      if (name.length > 30) return toast('群聊名称最多 30 个字')
      const category = this.data.chatCategoryNames[form.categoryIndex] || ''
      if (!category) return toast('请选择群类别')
      const intro = String(form.intro || '').trim()
      if (!intro) return toast('请填写群介绍，用户端群聊列表会展示')
      const notice = String(form.notice || '').trim()
      if (notice.length > 500) return toast('群公告最多 500 个字')
      const ownerName = String(form.ownerName || '').trim()
      if (ownerName.length > 32) return toast('群主昵称最多 32 个字')
      const memberRaw = String(form.memberCount === undefined || form.memberCount === null ? '' : form.memberCount).trim()
      let memberCount = 0
      if (memberRaw) {
        if (!/^\d+$/.test(memberRaw)) return toast('群成员数只能填写整数')
        memberCount = Number(memberRaw)
        if (memberCount > MAX_MEMBER_COUNT) return toast('群成员数不能超过 ' + MAX_MEMBER_COUNT)
      }
      const sortRaw = String(form.sortOrder === undefined || form.sortOrder === null ? '' : form.sortOrder).trim()
      if (sortRaw && !/^-?\d+$/.test(sortRaw)) return toast('排序需填写整数')
      const metaObj = form.meta || {}
      const joinMode = (JOIN_MODE_OPTIONS[form.joinModeIndex] || JOIN_MODE_OPTIONS[0]).value
      if (joinMode === 'qrcode' && !metaObj.qrcodeUrl) return toast('进群方式为「扫码进群」时请先上传群二维码')
      const images = Array.isArray(metaObj.images) ? metaObj.images : []
      if (images.length > 5) return toast('图片介绍最多 5 张')
      const payload = {
        name, category, campus: form.campus || '', intro, notice, ownerName, memberCount, joinMode,
        needAudit: form.needAudit ? 1 : 0, images,
        avatarUrl: metaObj.avatarUrl || '', qrcodeUrl: metaObj.qrcodeUrl || '', gzhQrcodeUrl: metaObj.gzhQrcodeUrl || '',
        isOfficial: form.isOfficial ? 1 : 0, customTag: String(form.customTag || '').trim(),
        sortOrder: sortRaw ? Number(sortRaw) : 0, status: form.status ? 1 : 0
      }
      form.id ? await admin.updateGroupChatGroup(form.id, payload) : await admin.createGroupChatGroup(payload)
      return true
    }

    if (scope === 'clubCategory') {
      const scopeArr = String(form.scopeText || '').split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean)
      const features = String(form.featuresText || '').split('\n').map((line) => {
        const idx = line.indexOf('|')
        if (idx < 0) return null
        const title = line.slice(0, idx).trim()
        const desc = line.slice(idx + 1).trim()
        return title && desc ? { title, desc } : null
      }).filter(Boolean)
      if (!String(form.name || '').trim()) return toast('请填写分类名称')
      if (!features.length && String(form.featuresText || '').trim()) return toast('特色说明格式应为：标题|描述')
      const payload = { name: String(form.name).trim(), iconChar: String(form.iconChar || '').trim(), slogan: String(form.slogan || '').trim(), color: (form.meta && form.meta.color) || '#2E6BFF', position: String(form.position || '').trim(), scopeIntro: String(form.scopeIntro || '').trim(), scope: scopeArr, features, contact: String(form.contact || '').trim(), sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0 }
      form.id ? await admin.updateClubCategory(form.id, payload) : await admin.createClubCategory(payload)
      return true
    }

    if (scope === 'club') {
      if (!form.categoryId) return toast('请选择所属分类')
      if (!String(form.name || '').trim()) return toast('请填写社团名称')
      const metaObj = form.meta || {}
      const payload = { categoryId: form.categoryId, name: String(form.name).trim(), tags: String(form.tags || '').trim(), intro: String(form.intro || '').trim(), recruit: String(form.recruit || '').trim(), campus: form.campus || '', sortOrder: Number(form.sortOrder) || 0, status: form.status ? 1 : 0, clubType: String(form.clubType || '学生社团').trim() || '学生社团', avatarUrl: metaObj.avatarUrl || '', qrcodeUrl: metaObj.qrcodeUrl || '', adminQrcodeUrl: metaObj.adminQrcodeUrl || '', gzhQrcodeUrl: metaObj.gzhQrcodeUrl || '', images: Array.isArray(metaObj.images) ? metaObj.images : [] }
      form.id ? await admin.updateClub(form.id, payload) : await admin.createClub(payload)
      return true
    }

    if (scope === 'activity') {
      const DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
      if (!String(form.title || '').trim()) return toast('请填写活动标题')
      const timeFields = [['signupStart', '报名时间'], ['signupEnd', '报名截止'], ['activityStart', '活动开始'], ['activityEnd', '活动结束']]
      const payload = { title: String(form.title).trim() }
      for (const [key, label] of timeFields) {
        const value = String(form[key] || '').trim()
        if (value && !DT_RE.test(value)) return toast(label + '格式需为 YYYY-MM-DD HH:mm')
        payload[key] = value
      }
      payload.location = String(form.location || '').trim()
      payload.address = String(form.address || '').trim()
      payload.campus = form.campus || ''
      payload.detailTitle = String(form.detailTitle || '').trim()
      payload.detailContent = String(form.detailContent || '').trim()
      payload.signupTitle = String(form.signupTitle || '').trim()
      payload.signupContent = String(form.signupContent || '').trim()
      payload.coverUrl = (form.meta && form.meta.coverUrl) || ''
      payload.images = Array.isArray(form.meta && form.meta.images) ? form.meta.images : []
      const capacity = parseInt(form.capacity, 10)
      payload.capacity = Number.isInteger(capacity) && capacity > 0 ? capacity : 0
      await admin.updateActivity(form.id, payload)
      return true
    }

    // ===== 审核动作（走二次确认） =====
    if (scope === 'chatReview') {
      const isApprove = form.action === 'approve'
      const note = String(form.reviewNote || '').trim()
      if (!isApprove && !note) return toast('驳回时请填写审核意见')
      if (!await this._confirm(isApprove ? '确认通过建群申请' : '确认驳回建群申请', isApprove ? '通过后「' + form.applyName + '」将立即上架到用户端群聊列表。' : '驳回后用户将在「我的申请」中看到审核意见。')) return 'abort'
      await admin.reviewGroupChatApply(form.id, form.action, note)
      return { toast: isApprove ? '已通过并上架' : '已驳回' }
    }

    if (scope === 'clubReview') {
      const isApprove = form.action === 'approve'
      const note = String(form.reviewNote || '').trim()
      if (!isApprove && !note) return toast('驳回时请填写审核意见')
      if (!await this._confirm(isApprove ? '确认通过社团申请' : '确认驳回社团申请', isApprove ? '通过后「' + form.applyName + '」将立即出现在用户端「社团&组织」的对应分类中。' : '驳回后用户将在「我的社团申请」中看到审核意见。')) return 'abort'
      await admin.reviewClubApply(form.id, form.action, note)
      return { toast: isApprove ? '已通过并上架' : '已驳回' }
    }

    if (scope === 'activityAudit') {
      const note = String(form.reviewNote || '').trim()
      if (!note) return toast('驳回时请填写审核意见')
      if (!await this._confirm('确认驳回活动', `驳回后「${this.data.activityTitle}」不会公开，发起人可在活动详情看到审核意见。`)) return 'abort'
      await admin.auditActivity(form.id, 'reject', note)
      return { toast: '已驳回' }
    }

    return toast('未知的编辑类型')
  },

  _confirm(title, content) {
    return new Promise((resolve) => {
      wx.showModal({ title, content, success: (res) => resolve(!!res.confirm), fail: () => resolve(false) })
    })
  },

  async onSave() {
    if (this.data.saving) return
    const scope = this.data.scope
    this.setData({ saving: true })
    try {
      const res = await this.buildPayload()
      if (res === false) { this.setData({ saving: false }); return }   // 校验拦下
      if (res === 'abort') { this.setData({ saving: false }); return } // 二次确认取消
      const toastTitle = (res && res.toast) ? res.toast : '已保存'
      wx.showToast({ title: toastTitle, icon: 'success' })
      // 通知后台列表刷新（后台 onShow 读取后清理）
      const app = getApp()
      if (app && app.globalData) app.globalData.adminEditDone = { scope, ts: Date.now() }
      this._snapshot = null
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
    } catch (e) {
      this.setData({ saving: false })
      // 接口层已提示错误（request.js 统一 toast），这里只在无提示时兜底
      if (e && e.message && !/^request:fail/.test(e.message)) { /* 保留接口层提示 */ }
    }
  },

  // 保存按钮文案（data.saveLabel 已在 onLoad 时算好）
  noop() {}
})
