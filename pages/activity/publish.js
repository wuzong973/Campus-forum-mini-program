const api = require('../../utils/api')
const wechat = require('../../utils/wechat')
const auth = require('../../utils/auth')
const { getDefaultCampus } = require('../../utils/campus')

Page({
  data: {
    statusBarHeight: 20,
    campus: '',
    showCampusPanel: false,
    title: '',
    signupStart: { date: '', time: '' },
    signupEnd: { date: '', time: '' },
    activityStart: { date: '', time: '' },
    activityEnd: { date: '', time: '' },
    location: '',
    address: '',
    cover: '',
    images: [],
    detailTitle: '',
    detailContent: '',
    signupTitle: '',
    signupContent: '',
    signupImage: '',
    capacity: '',
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

  // 校区选择器组件回调（含主校区/分校区两级）
  onCampusChange(e) {
    const campus = e.detail.value
    if (!campus) return
    this.setData({ campus, showCampusPanel: false })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/activity/index' })
    })
  },

  toast(title) {
    wx.showToast({ title, icon: 'none' })
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }) },
  onLocationInput(e) { this.setData({ location: e.detail.value }) },
  onAddressInput(e) { this.setData({ address: e.detail.value }) },
  onDetailTitleInput(e) { this.setData({ detailTitle: e.detail.value }) },
  onDetailContentInput(e) { this.setData({ detailContent: e.detail.value }) },
  onSignupTitleInput(e) { this.setData({ signupTitle: e.detail.value }) },
  onSignupContentInput(e) { this.setData({ signupContent: e.detail.value }) },
  onCapacityInput(e) { this.setData({ capacity: e.detail.value }) },

  // 时间选择：日期 + 时间两组 picker
  onDateChange(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [field + '.date']: e.detail.value })
  },

  onTimeChange(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [field + '.time']: e.detail.value })
  },

  composeTime(field) {
    const part = this.data[field]
    if (!part || !part.date || !part.time) return ''
    return part.date + ' ' + part.time
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

  async onUploadCover() {
    const path = await this.chooseImage()
    if (path) this.setData({ cover: path })
  },

  onClearCover() { this.setData({ cover: '' }) },

  onPreviewCover() {
    if (this.data.cover) wx.previewImage({ urls: [this.data.cover] })
  },

  async onAddImage() {
    const remain = 9 - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        this.setData({ images: this.data.images.concat(paths).slice(0, 9) })
      }
    })
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: this.data.images.length ? this.data.images : [url], current: url })
  },

  async onUploadSignupImage() {
    const path = await this.chooseImage()
    if (path) this.setData({ signupImage: path })
  },

  onClearSignupImage() { this.setData({ signupImage: '' }) },

  onSubmit() {
    if (this.data.submitting) return
    const d = this.data
    if (!auth.isLoggedIn()) {
      auth.requireLogin('发起活动需要先登录')
      return
    }
    if (!d.title.trim()) return this.toast('请填写活动标题')
    if (!d.cover) return this.toast('请上传封面图片')

    const signupStart = this.composeTime('signupStart')
    const signupEnd = this.composeTime('signupEnd')
    const activityStart = this.composeTime('activityStart')
    const activityEnd = this.composeTime('activityEnd')
    if (signupStart && signupEnd && signupStart > signupEnd) return this.toast('报名结束时间需晚于开始时间')
    if (activityStart && activityEnd && activityStart > activityEnd) return this.toast('活动结束时间需晚于开始时间')

    const capacityNum = parseInt(d.capacity, 10)
    this.setData({ submitting: true })

    // 收集需上传图片（顺序：封面 → 详细图 → 报名图片）
    const singleDefs = [
      { key: 'coverUrl', path: d.cover },
      { key: 'signupImage', path: d.signupImage }
    ].filter((item) => item.path)
    const allPaths = singleDefs.map((item) => item.path).concat(d.images)

    wechat.uploadImages(allPaths).then((urls) => {
      const urlMap = {}
      singleDefs.forEach((item, index) => { urlMap[item.key] = urls[index] || '' })
      const imageUrls = urls.slice(singleDefs.length)
      return api.createActivity({
        title: d.title.trim(),
        campus: d.campus,
        signupStart,
        signupEnd,
        activityStart,
        activityEnd,
        location: d.location.trim(),
        address: d.address.trim(),
        coverUrl: urlMap.coverUrl || '',
        images: imageUrls,
        detailTitle: d.detailTitle.trim(),
        detailContent: d.detailContent.trim(),
        signupTitle: d.signupTitle.trim(),
        signupContent: d.signupContent.trim(),
        signupImage: urlMap.signupImage || '',
        capacity: Number.isInteger(capacityNum) && capacityNum > 0 ? capacityNum : 0
      })
    }).then(() => {
      wx.showToast({ title: '发布成功', icon: 'success', duration: 1000 })
      setTimeout(() => {
        this.setData({ submitting: false })
        wx.navigateBack({
          fail: () => wx.redirectTo({ url: '/pages/activity/index' })
        })
      }, 900)
    }).catch((err) => {
      this.setData({ submitting: false })
      this.toast((err && err.message) || '发布失败，请重试')
    })
  }
})
