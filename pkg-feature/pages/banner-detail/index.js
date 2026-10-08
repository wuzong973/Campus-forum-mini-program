const app = getApp()
const api = require('../../../utils/api')
const wechat = require('../../../utils/wechat')
const messageStore = require('../../../utils/messageStore')
const qr = require('../../../utils/qr')
const richtext = require('../../../utils/richtext')

// 横幅编辑发布权限与后端 config.manage 对齐（super_admin/content_admin/operator）
const BANNER_ADMIN_ROLES = ['super_admin', 'content_admin', 'operator']

function normalizeHex(v) {
  const s = String(v || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s
  return ''
}

// 横幅自定义颜色内联样式：背景色直接生效，文字色经 CSS 变量 --banner-fg 级联到子元素
function bannerInlineStyle(banner) {
  return (banner.bgColor ? 'background:' + banner.bgColor + ';' : '') + (banner.textColor ? '--banner-fg:' + banner.textColor + ';' : '')
}

const EMPTY_FORM = {
  text: '',
  icon: '',
  detailTitle: '',
  detailContent: '',
  guideBtnText: '',
  images: [],
  link: '',
  linkText: '',
  bgColor: '',
  textColor: '',
  status: true
}

// 「自定义页面」类 scope：复用本页的表单与展示，但字段是 { title, content, images, status }。
// campusCard 可配多张（带 id 编辑某一张）；drivingGuide 是单张运营位（不传 id 时先取现有页面原地更新）；
// market 为校园市场四分类页（每类一张，具体分类由 URL 的 category 参数决定）
const MARKET_CATEGORY_LABELS = {
  rental: '租赁服务',
  digital: '校园数码',
  housekeeping: '校园家政',
  diypc: 'DIY电脑'
}
let marketCategory = ''
const PAGE_SCOPES = {
  campusCard: {
    label: '校园卡页面',
    createLabel: '新增校园卡页面',
    single: false,
    fetch: (id) => (id ? api.getCampusCardPage(id) : Promise.resolve(null)),
    create: (payload) => api.createCampusCardPage(payload),
    save: (id, payload) => api.saveCampusCardPage(id, payload)
  },
  drivingGuide: {
    label: '学车指南',
    createLabel: '编辑学车指南',
    single: true,
    fetch: () => api.getDrivingGuidePage(),
    create: (payload) => api.createDrivingGuidePage(payload),
    save: (id, payload) => api.saveDrivingGuidePage(id, payload)
  },
  market: {
    label: '校园市场页面',
    createLabel: '编辑市场页面',
    single: true,
    fetch: () => api.getMarketPage(marketCategory),
    create: (payload) => api.createMarketPage(marketCategory, payload),
    save: (id, payload) => api.saveMarketPage(marketCategory, id, payload)
  },
  // 校园圈学车落地页：找驾校列表页顶部横幅的跳转目标，与「学车指南」分开编辑
  promoLanding: {
    label: '校园圈学车页面',
    createLabel: '编辑校园圈学车页面',
    single: true,
    fetch: () => api.getPromoLandingPage(),
    create: (payload) => api.createPromoLandingPage(payload),
    save: (id, payload) => api.savePromoLandingPage(id, payload)
  }
}

Page({
  data: {
    banner: { text: '', icon: '', detailTitle: '', detailContent: '', images: [], link: '', linkText: '', bgColor: '', textColor: '', status: true },
    blocks: [],
    loaded: false,
    isAdmin: false,
    // 自定义页面模式（校园卡 / 学车指南）：复用同一套表单样式，隐藏横幅专属字段（文字/图标/配色/预览/链接），
    // 「发布横幅」改为「发布状态」；pageLabel 用于表单里的文案随 scope 切换
    isCard: false,
    isDrivingGuide: false,
    pageLabel: '',
    // 编辑态
    editing: false,
    saving: false,
    form: Object.assign({}, EMPTY_FORM),
    // 颜色选择器
    colorPickerShow: false,
    colorPickerField: '',
    colorPickerValue: '',
    colorPickerTitle: '选择颜色'
  },

  onLoad(options) {
    // scope=post → 帖子详情页「每日热榜」上方横幅；scope=publish → 发布页顶部横幅详情（只读）；
    // scope=campusCard / drivingGuide / market → 后台可编辑的自定义页面（管理后台「物品」入口跳入）；默认 message → 消息通知横幅
    this.scope = ['post', 'publish', 'campusCard', 'drivingGuide', 'market', 'promoLanding'].indexOf(options.scope) >= 0 ? options.scope : 'message'
    // market scope：分类由 URL 决定，页面标题带上分类名（如「编辑市场页面 · 租赁服务」）
    if (this.scope === 'market') {
      marketCategory = MARKET_CATEGORY_LABELS[options.category] ? options.category : ''
      if (!marketCategory) {
        wx.showToast({ title: '市场分类不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 900)
        return
      }
    }
    this.pageScope = PAGE_SCOPES[this.scope] || null
    // publish 模式下按公告 id 精准展示对应横幅（发布页可配置多条公告，各自进各自详情）
    this.publishBannerId = options.id || ''
    // 自定义页面：带 id 编辑既有页面，不带 id 为新建（单张运营位取到现有页面后会补上 id）
    this.cardId = this.pageScope ? (options.id || '') : ''
    this.cardCreateMode = !!this.pageScope && !options.id && !this.pageScope.single
    const userInfo = app.globalData.userInfo || {}
    // publish 横幅在管理后台「内容配置-发布横幅」中编辑，本页仅展示
    this.setData({
      isCard: !!this.pageScope,
      isDrivingGuide: this.scope === 'drivingGuide',
      pageLabel: this.pageScope ? this.pageScope.label : '',
      isAdmin: BANNER_ADMIN_ROLES.indexOf(userInfo.role) >= 0 && this.scope !== 'publish'
    })
    // 管理员保存后服务端 WS 广播，在线用户进入本页/停留时立即刷新
    this.unsubscribe = messageStore.onMessage((payload) => {
      if (payload && payload.type === 'banner_update') {
        if (payload.data && payload.data.scope && payload.data.scope !== this.scope) return
        this.loadBanner()
      }
    })
    this.loadBanner().then(() => {
      // 后台「编辑页面」按钮跳入时直接进编辑态；「新增校园卡」跳入时空表单直接进编辑态
      if ((options.edit === '1' || this.cardCreateMode) && this.data.isAdmin && this.data.banner) this.onStartEdit()
    })
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  fetchBanner() {
    if (this.scope === 'publish') return api.getPublishBanner(this.publishBannerId)
    if (this.pageScope) return this.pageScope.fetch(this.cardId)
    return this.scope === 'post' ? api.getPostBanner() : api.getMessageBanner()
  },

  submitBanner(payload) {
    if (this.pageScope) {
      if (this.cardId) return this.pageScope.save(this.cardId, payload)
      // 新建成功后记住 id，同页二次保存走更新而不是再插一条
      return this.pageScope.create(payload).then((res) => {
        this.cardId = (res && res.id) || ''
        this.cardCreateMode = false
      })
    }
    return this.scope === 'post' ? api.savePostBanner(payload) : api.saveMessageBanner(payload)
  },

  loadBanner() {
    return this.fetchBanner().then((raw) => {
      // 单张运营位（学车指南）后台跳入时不带 id：取到现有页面后补上，避免保存时重复插入
      if (this.pageScope && this.pageScope.single && raw && !this.cardId) {
        this.cardId = raw.id
        this.cardCreateMode = false
      }
      // 自定义页面数据结构 { title, content }，映射进横幅展示字段（detailTitle/detailContent）复用同一套渲染
      // link/linkText 不再清空：它们与横幅同名字段语义一致（横幅=点横幅跳转，自定义页=正文下方按钮）
      const banner = this.pageScope && raw
        ? Object.assign({}, raw, { text: '', icon: '', detailTitle: raw.title || '', detailContent: raw.content || '', link: raw.link || '', linkText: raw.linkText || '', bgColor: '', textColor: '' })
        : raw
      const data = banner || { text: '', icon: '', detailTitle: '', detailContent: '', images: [], link: '', linkText: '', bgColor: '', textColor: '', status: true }
      if (!Array.isArray(data.images)) data.images = []
      if (data.status === undefined) data.status = true
      data.bannerStyle = bannerInlineStyle(data)
      this.setData({
        banner: data,
        loaded: true,
        blocks: richtext.parseBlocks(data.detailContent)
      })
      // 导航栏标题按场域固定，不受后台内容影响，加载失败也保持不变
      const navTitle = this.pageScope
        ? (this.scope === 'market' && MARKET_CATEGORY_LABELS[marketCategory]
          ? this.pageScope.label + ' · ' + MARKET_CATEGORY_LABELS[marketCategory]
          : (this.cardCreateMode ? this.pageScope.createLabel : this.pageScope.label))
        : '公告详情'
      wx.setNavigationBarTitle({ title: navTitle })
    }).catch(() => {
      this.setData({ loaded: true })
    })
  },

  // ===== 展示态交互 =====
  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (url) wechat.previewImages(this.data.banner.images, url)
  },

  // ===== 长按识别二维码（全站统一：utils/qr 菜单 + 解码 + 内容分发） =====
  onImageLongPress(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    qr.recognize(url, this.data.banner.images)
  },

  // 预览里的「点击跳转」：直接复用正文链接的统一口径（utils/richtext.openLink），
  // 不再自己抄一份只认 /pages/ 的分支 —— 分包路径 /pkg-feature/pages/... 会漏判。
  onOpenLink() {
    richtext.openLink(this.data.banner.link)
  },

  // ===== 管理员编辑 =====
  onStartEdit() {
    const b = this.data.banner
    this.setData({
      editing: true,
      form: {
        text: b.text || '',
        icon: b.icon || '',
        detailTitle: b.detailTitle || '',
        detailContent: b.detailContent || '',
        guideBtnText: b.guideBtnText || '',
        images: (b.images || []).slice(),
        link: b.link || '',
        linkText: b.linkText || '',
        bgColor: b.bgColor || '',
        textColor: b.textColor || '',
        status: b.status !== false
      }
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  onCancelEdit() {
    this.setData({ editing: false })
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ ['form.' + field]: e.detail.value })
  },

  // 跳转链接由 components/link-picker 负责（选页面 / 选帖子 / 手动输入），
  // 这里只接收它回传的最终路径，与后台其它跳转配置点同一套交互。
  onLinkPicked(e) {
    this.setData({ 'form.link': (e.detail && e.detail.value) || '' })
  },

  onStatusChange(e) {
    this.setData({ 'form.status': !!e.detail.value })
  },

  // ===== 横幅自定义颜色：背景颜色 / 文字颜色 =====
  openPageColorPicker(e) {
    const field = e.currentTarget.dataset.field === 'textColor' ? 'textColor' : 'bgColor'
    this.setData({
      colorPickerField: field,
      colorPickerValue: this.data.form[field] || '',
      colorPickerTitle: field === 'textColor' ? '选择文字颜色' : '选择背景颜色',
      colorPickerShow: true
    })
  },
  onPageColorPickerClose() { this.setData({ colorPickerShow: false }) },
  onPageColorPickerConfirm(e) {
    const hex = normalizeHex(e.detail && e.detail.hex)
    const field = this.data.colorPickerField
    if (field) this.setData({ ['form.' + field]: hex, colorPickerShow: false })
    else this.setData({ colorPickerShow: false })
  },

  onChooseImage() {
    const remain = 9 - this.data.form.images.length
    if (remain <= 0) return
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
          this.setData({ 'form.images': this.data.form.images.concat(urls).slice(0, 9) })
        }).catch((err) => {
          wx.hideLoading()
          wx.showToast({ title: (err && err.message) || '图片上传失败', icon: 'none' })
        })
      }
    })
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (isNaN(index)) return
    const images = this.data.form.images.slice()
    images.splice(index, 1)
    this.setData({ 'form.images': images })
  },

  onPreviewFormImage(e) {
    const url = e.currentTarget.dataset.url
    if (url) wechat.previewImages(this.data.form.images, url)
  },

  onSave() {
    const form = this.data.form
    const isCard = this.data.isCard
    if (isCard) {
      if (!String(form.detailTitle || '').trim()) {
        wx.showToast({ title: '请填写页面标题', icon: 'none' })
        return
      }
      if (!String(form.detailContent || '').trim() && !form.images.length) {
        wx.showToast({ title: '正文与图片不能同时为空', icon: 'none' })
        return
      }
    } else if (!String(form.text || '').trim()) {
      wx.showToast({ title: '请填写横幅文字', icon: 'none' })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    // 两类表单共有 link/linkText：横幅用它做「点击横幅跳转」，
    // 自定义页面用它做「正文下方的跳转按钮」（留空则按钮不显示）。
    const link = String(form.link || '').trim()
    const linkText = String(form.linkText || '').trim()
    const payload = isCard
      ? { title: String(form.detailTitle || '').trim(), content: form.detailContent, images: form.images, status: form.status, link, linkText }
      : {
        text: form.text,
        icon: form.icon,
        detailTitle: form.detailTitle,
        detailContent: form.detailContent,
        images: form.images,
        link: form.link,
        linkText: form.linkText,
        bgColor: form.bgColor,
        textColor: form.textColor,
        status: form.status
      }
    // 只有「学车指南」这一类页面带入口按钮文字，其他自定义页面不提交这个键
    if (isCard && this.data.isDrivingGuide) payload.guideBtnText = String(form.guideBtnText || '').trim()
    this.submitBanner(payload).then(() => {
      this.setData({ editing: false, saving: false })
      wx.showToast({ title: form.status ? '已发布' : '已保存（下线）', icon: 'success' })
      // 保存成功后立即回读，页面即时呈现最新内容；其他在线用户经 WS 广播刷新
      this.loadBanner()
    }).catch((err) => {
      this.setData({ saving: false })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    })
  }
})
