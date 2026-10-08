const api = require('../../../utils/api')
const wechat = require('../../../utils/wechat')
const auth = require('../../../utils/auth')
const { getDefaultCampus } = require('../../../utils/campus')

// 社团类型（当前仅支持学生社团）
const CLUB_TYPES = ['学生社团']
// 服务端分类拉取失败时的兜底选项（与前台六大分类一致）
const FALLBACK_CATEGORY_NAMES = ['艺术类', '体育类', '科技类', '人文类', '实践类', '创新创业类']

Page({
  data: {
    statusBarHeight: 20,
    clubTypes: CLUB_TYPES,
    categoryNames: FALLBACK_CATEGORY_NAMES,
    categoryIds: [],
    categoryIndex: -1,
    campus: '',
    showCampusPanel: false,
    name: '',
    adminQr: '',
    avatar: '',
    qrcode: '',
    gzhQr: '',
    intro: '',
    images: [],
    submitting: false
  },

  onLoad() {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20, campus: getDefaultCampus() })
    this.loadCategories()
  },

  onShow() {
    // 未登录：弹窗引导去登录（取消则退回上一页），登录后回到本页自动放行
    if (!auth.guardPage('申请创建社团需要先登录')) return
    // 从设置页/登录页返回时同步所选校区；用户手动改过校区时尊重其选择
    if (!this._campusTouched) {
      const def = getDefaultCampus()
      if (def !== this.data.campus) this.setData({ campus: def })
    }
  },

  // 分类选择器数据源：读服务端「社团分类管理」维护的分类（停用分类不出现在选项里）
  loadCategories() {
    api.getClubCategories().then((res) => {
      const list = ((res && res.list) || []).filter((item) => item && item.name && Number(item.status) !== 0)
      if (!list.length) return
      this.setData({
        categoryNames: list.map((item) => item.name),
        categoryIds: list.map((item) => item.id)
      })
    }).catch(() => {})
  },

  noop() {},

  onToggleCampus() {
    this.setData({ showCampusPanel: !this.data.showCampusPanel })
  },

  onCloseCampus() {
    this.setData({ showCampusPanel: false })
  },

  // 校区选择器组件回调（仅主校区层级：全部校区/广州校区/佛山校区）
  onCampusChange(e) {
    const campus = e.detail.value
    this._campusTouched = true
    this.setData({ campus, showCampusPanel: false })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pkg-feature/pages/club/index' })
    })
  },

  onPickCategory(e) {
    this.setData({ categoryIndex: Number(e.detail.value) || 0 })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onIntroInput(e) {
    this.setData({ intro: e.detail.value })
  },

  chooseImage() {
    return new Promise((resolve) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0]
          resolve(file ? file.tempFilePath : '')
        },
        fail: () => resolve('')
      })
    })
  },

  // 负责人微信二维码
  async onUploadAdmin() {
    const path = await this.chooseImage()
    if (path) this.setData({ adminQr: path })
  },

  onClearAdmin() {
    this.setData({ adminQr: '' })
  },

  // 社团头像
  async onUploadAvatar() {
    const path = await this.chooseImage()
    if (path) this.setData({ avatar: path })
  },

  onClearAvatar() {
    this.setData({ avatar: '' })
  },

  // 社团二维码（招新群/联系方式）
  async onUploadQrcode() {
    const path = await this.chooseImage()
    if (path) this.setData({ qrcode: path })
  },

  onClearQrcode() {
    this.setData({ qrcode: '' })
  },

  async onUploadGzh() {
    const path = await this.chooseImage()
    if (path) this.setData({ gzhQr: path })
  },

  onClearGzh() {
    this.setData({ gzhQr: '' })
  },

  async onAddIntroImage() {
    const remain = 5 - this.data.images.length
    if (remain <= 0) { this.toast('最多上传 5 张图片'); return }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        this.setData({ images: this.data.images.concat(paths).slice(0, 5) })
      }
    })
  },

  onRemoveIntroImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: [url] })
  },

  toast(title) {
    wx.showToast({ title, icon: 'none' })
  },

  onSubmit() {
    if (this.data.submitting) return
    const d = this.data
    const categoryIndex = d.categoryIndex
    if (categoryIndex < 0) return this.toast('请选择社团分类')
    if (!d.name.trim()) return this.toast('请填写社团名称')
    if (!d.avatar) return this.toast('请上传社团头像')
    if (!d.qrcode) return this.toast('请上传社团二维码')
    if (!d.adminQr) return this.toast('请上传负责人微信二维码')
    if (!d.intro.trim()) return this.toast('请填写文字介绍')
    this.setData({ submitting: true })

    // 图片上传服务器换 https 地址后提交服务端，由管理员统一审核
    this.submitToServer(categoryIndex)
  },

  submitToServer(categoryIndex) {
    const d = this.data
    const singleDefs = [
      { key: 'avatarUrl', path: d.avatar },
      { key: 'qrcodeUrl', path: d.qrcode },
      { key: 'adminQrcodeUrl', path: d.adminQr },
      { key: 'gzhQrcodeUrl', path: d.gzhQr }
    ].filter((item) => item.path)
    const allPaths = singleDefs.map((item) => item.path).concat(d.images)

    wechat.uploadImages(allPaths).then((urls) => {
      const urlMap = {}
      singleDefs.forEach((item, index) => { urlMap[item.key] = urls[index] || '' })
      const introUrls = urls.slice(singleDefs.length)
      return api.submitClubApply({
        clubType: CLUB_TYPES[0],
        categoryId: d.categoryIds[categoryIndex] || 0,
        categoryName: d.categoryNames[categoryIndex] || '',
        campus: d.campus,
        name: d.name.trim(),
        intro: d.intro.trim(),
        avatarUrl: urlMap.avatarUrl || '',
        qrcodeUrl: urlMap.qrcodeUrl || '',
        adminQrcodeUrl: urlMap.adminQrcodeUrl || '',
        gzhQrcodeUrl: urlMap.gzhQrcodeUrl || '',
        images: introUrls
      })
    }).then(() => {
      this.finishSubmit('提交成功，等待管理员审核')
    }).catch((err) => {
      this.setData({ submitting: false })
      this.toast((err && err.message) || '提交失败，请稍后重试')
    })
  },

  finishSubmit(toastText) {
    wx.showToast({ title: toastText, icon: 'none', duration: 1200 })
    setTimeout(() => {
      this.setData({ submitting: false })
      wx.navigateBack({
        fail: () => wx.redirectTo({ url: '/pkg-feature/pages/club/index' })
      })
    }, 1000)
  }
})
