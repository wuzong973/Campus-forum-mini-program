const api = require('../../utils/api')
const wechat = require('../../utils/wechat')
const auth = require('../../utils/auth')
const { getDefaultCampus } = require('../../utils/campus')

const CATEGORIES = [
  '学院群',
  '线下桌游群',
  '体育运动群',
  '老乡群',
  '学习竞赛',
  '互助群',
  '游戏群',
  '新生群'
]

// 申请记录本地暂存 key（等待管理员审核接入后改为提交服务端）
const APPLY_STORAGE_KEY = 'group_chat_applies'

Page({
  data: {
    statusBarHeight: 20,
    categories: CATEGORIES,
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
    if (!auth.guardPage('申请创建群聊需要先登录')) return
    // 从设置页/登录页返回时同步所选校区；用户手动改过校区时尊重其选择
    if (!this._campusTouched) {
      const def = getDefaultCampus()
      if (def !== this.data.campus) this.setData({ campus: def })
    }
  },

  // 类别选择器数据源：优先读服务端（管理后台「群聊类别编辑」维护），失败回退内置分类
  loadCategories() {
    api.getGroupChatCategories().then((res) => {
      const names = ((res && res.list) || [])
        .filter((c) => c && c.name && c.status !== 0)
        .map((c) => c.name)
      if (names.length) this.setData({ categories: names })
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
      fail: () => wx.redirectTo({ url: '/pages/group-chat/index' })
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

  async onUploadAdmin() {
    const path = await this.chooseImage()
    if (path) this.setData({ adminQr: path })
  },

  onClearAdmin() {
    this.setData({ adminQr: '' })
  },

  async onUploadAvatar() {
    const path = await this.chooseImage()
    if (path) this.setData({ avatar: path })
  },

  onClearAvatar() {
    this.setData({ avatar: '' })
  },

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
    // 类别取实际展示列表的选中项（服务端类别加载后与内置 CATEGORIES 顺序可能不同）
    const category = d.categories[d.categoryIndex] || ''
    if (!d.name.trim()) return this.toast('请填写群名')
    if (!category) return this.toast('请选择群类别')
    if (!d.avatar) return this.toast('请上传群头像')
    if (!d.qrcode) return this.toast('请上传群二维码')
    if (!d.adminQr) return this.toast('请上传管理员微信二维码')
    if (!d.intro.trim()) return this.toast('请填写文字介绍')
    this.setData({ submitting: true })

    // 已登录 → 图片上传服务器换 https 地址后提交服务端，由管理员统一审核
    if (auth.isLoggedIn()) {
      this.submitToServer(category)
      return
    }
    // 未登录 → 保持原有本地暂存流程
    this.saveLocal(category)
    this.finishSubmit('提交成功，等待管理员审核')
  },

  submitToServer(category) {
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
      return api.submitGroupChatApply({
        groupType: '微信群',
        category: category,
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
    }).catch(() => {
      // 上传/提交失败 → 回退本地暂存，不丢用户填写内容
      this.saveLocal(category)
      this.finishSubmit('网络异常，已暂存本地')
    })
  },

  // 本地暂存（服务端不可达或未登录时的兜底）
  saveLocal(category) {
    const d = this.data
    let list = []
    try {
      list = wx.getStorageSync(APPLY_STORAGE_KEY) || []
    } catch (err) {
      list = []
    }
    list.unshift({
      id: 'gc' + Date.now(),
      type: '微信群',
      category: category,
      campus: d.campus,
      name: d.name.trim(),
      avatar: d.avatar,
      qrcode: d.qrcode,
      adminQr: d.adminQr,
      gzhQr: d.gzhQr,
      intro: d.intro.trim(),
      images: d.images,
      status: '待审核',
      createdAt: Date.now()
    })
    try {
      wx.setStorageSync(APPLY_STORAGE_KEY, list)
    } catch (err) {
      // 存储失败不阻断流程
    }
  },

  finishSubmit(toastText) {
    wx.showToast({ title: toastText, icon: 'none', duration: 1200 })
    setTimeout(() => {
      this.setData({ submitting: false })
      wx.navigateBack({
        fail: () => wx.redirectTo({ url: '/pages/group-chat/index' })
      })
    }, 1000)
  }
})
