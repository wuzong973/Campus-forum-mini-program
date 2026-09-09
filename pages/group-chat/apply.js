const api = require('../../utils/api')
const wechat = require('../../utils/wechat')
const auth = require('../../utils/auth')
const { CAMPUS_OPTIONS, getDefaultCampus } = require('../../utils/campus')

const CATEGORIES = [
  '学院群',
  '线下桌游群',
  '飞梦',
  '体育运动群',
  '老乡群',
  '学习竞赛',
  '交易群',
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
    campusOptions: CAMPUS_OPTIONS,
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
  },

  noop() {},

  onToggleCampus() {
    this.setData({ showCampusPanel: !this.data.showCampusPanel })
  },

  onCloseCampus() {
    this.setData({ showCampusPanel: false })
  },

  onSelectCampus(e) {
    const campus = e.currentTarget.dataset.value
    if (!campus) return
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
    const remain = 4 - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        this.setData({ images: this.data.images.concat(paths).slice(0, 4) })
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
    if (!d.name.trim()) return this.toast('请填写群名')
    if (d.categoryIndex < 0) return this.toast('请选择群类别')
    if (!d.avatar) return this.toast('请上传群头像')
    if (!d.qrcode) return this.toast('请上传群二维码')
    if (!d.adminQr) return this.toast('请上传管理员微信二维码')
    if (!d.intro.trim()) return this.toast('请填写文字介绍')
    this.setData({ submitting: true })

    // 已登录 → 图片上传服务器换 https 地址后提交服务端，由管理员统一审核
    if (auth.isLoggedIn()) {
      this.submitToServer()
      return
    }
    // 未登录 → 保持原有本地暂存流程
    this.saveLocal()
    this.finishSubmit('提交成功，等待管理员审核')
  },

  submitToServer() {
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
        category: CATEGORIES[d.categoryIndex],
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
      this.saveLocal()
      this.finishSubmit('网络异常，已暂存本地')
    })
  },

  // 本地暂存（服务端不可达或未登录时的兜底）
  saveLocal() {
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
      category: CATEGORIES[d.categoryIndex],
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
