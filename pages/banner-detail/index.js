const app = getApp()
const api = require('../../utils/api')
const wechat = require('../../utils/wechat')
const messageStore = require('../../utils/messageStore')
const qr = require('../../utils/qr')

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
  images: [],
  link: '',
  linkText: '',
  bgColor: '',
  textColor: '',
  status: true
}

Page({
  data: {
    banner: { text: '', icon: '', detailTitle: '', detailContent: '', images: [], link: '', linkText: '', bgColor: '', textColor: '', status: true },
    paragraphs: [],
    loaded: false,
    isAdmin: false,
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
    // 默认 message → 「我的」页消息通知横幅
    this.scope = options.scope === 'post' ? 'post' : (options.scope === 'publish' ? 'publish' : 'message')
    // publish 模式下按公告 id 精准展示对应横幅（发布页可配置多条公告，各自进各自详情）
    this.publishBannerId = options.id || ''
    const userInfo = app.globalData.userInfo || {}
    // publish 横幅在管理后台「内容配置-发布横幅」中编辑，本页仅展示
    this.setData({ isAdmin: BANNER_ADMIN_ROLES.indexOf(userInfo.role) >= 0 && this.scope !== 'publish' })
    // 管理员保存后服务端 WS 广播，在线用户进入本页/停留时立即刷新
    this.unsubscribe = messageStore.onMessage((payload) => {
      if (payload && payload.type === 'banner_update') {
        if (payload.data && payload.data.scope && payload.data.scope !== this.scope) return
        this.loadBanner()
      }
    })
    this.loadBanner()
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  fetchBanner() {
    if (this.scope === 'publish') return api.getPublishBanner(this.publishBannerId)
    return this.scope === 'post' ? api.getPostBanner() : api.getMessageBanner()
  },

  submitBanner(payload) {
    return this.scope === 'post' ? api.savePostBanner(payload) : api.saveMessageBanner(payload)
  },

  loadBanner() {
    return this.fetchBanner().then((banner) => {
      const data = banner || { text: '', icon: '', detailTitle: '', detailContent: '', images: [], link: '', linkText: '', bgColor: '', textColor: '', status: true }
      if (!Array.isArray(data.images)) data.images = []
      if (data.status === undefined) data.status = true
      data.bannerStyle = bannerInlineStyle(data)
      this.setData({
        banner: data,
        loaded: true,
        paragraphs: this.splitParagraphs(data.detailContent)
      })
      // 导航栏标题固定为「公告详情」，不受后台横幅文字/详情标题影响，加载失败也保持不变
      wx.setNavigationBarTitle({ title: '公告详情' })
    }).catch(() => {
      this.setData({ loaded: true })
    })
  },

  splitParagraphs(content) {
    return String(content || '').split('\n').map((line) => line.trim()).filter(Boolean)
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

    onOpenLink(e) {
    const link = this.data.banner.link || ''
    if (!link) return
    if (link.indexOf('/pages/') === 0) {
      wx.navigateTo({ url: link, fail: () => this.copyLink(link) })
      return
    }
    if (/^https:\/\//i.test(link)) {
      wx.navigateTo({ url: '/pages/webview/index?url=' + encodeURIComponent(link) })
      return
    }
    this.copyLink(link)
  },

  copyLink(link) {
    wx.setClipboardData({
      data: link,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    })
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
    if (!String(form.text || '').trim()) {
      wx.showToast({ title: '请填写横幅文字', icon: 'none' })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    this.submitBanner({
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
    }).then(() => {
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
