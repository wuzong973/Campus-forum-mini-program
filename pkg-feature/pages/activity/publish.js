const api = require('../../../utils/api')
const wechat = require('../../../utils/wechat')
const auth = require('../../../utils/auth')
const subscribe = require('../../../utils/subscribe')
const { getDefaultCampus } = require('../../../utils/campus')

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
    signupImages: [],
    capacity: '',
    submitting: false,
    publishAuditStatus: '',
    // 顶部「订阅活动审核提醒」入口：订阅生效（偏好开 + 微信侧已授权）后隐藏，
    // 在设置页关闭「活动审核通知」后重新出现（见 refreshActivityPublishSubscribeEntry）
    showActivityPublishSubscribeEntry: false,
    activityPublishSubscribeChecked: false
  },

  onLoad() {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20, campus: getDefaultCampus() })
  },

  onToggleCampus() {
    this.setData({ showCampusPanel: !this.data.showCampusPanel })
  },

  onCloseCampus() {
    this.setData({ showCampusPanel: false })
  },

  // 校区选择器组件回调（仅主校区层级；'' = 全部校区）
  onCampusChange(e) {
    const campus = e.detail.value || ''
    this.setData({ campus, showCampusPanel: false })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pkg-feature/pages/activity/index' })
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

  onRemoveSignupImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const signupImages = this.data.signupImages.slice()
    signupImages.splice(index, 1)
    this.setData({ signupImages })
  },

  onPreviewSignupImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: this.data.signupImages.length ? this.data.signupImages : [url], current: url })
  },

  async onAddSignupImage() {
    const remain = 5 - this.data.signupImages.length
    if (remain <= 0) { this.toast('最多上传 5 张图片'); return }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        this.setData({ signupImages: this.data.signupImages.concat(paths).slice(0, 5) })
      }
    })
  },

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
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap('activityPublish')
    this.setData({ submitting: true })

    // 收集需上传图片（顺序：封面 → 详细图 → 报名图片）
    const allPaths = [d.cover].filter(Boolean).concat(d.images, d.signupImages)

    wechat.uploadImages(allPaths).then((urls) => {
      const coverUrl = urls[0] || ''
      const detailCount = d.images.length
      const imageUrls = urls.slice(1, 1 + detailCount)
      const signupImageUrls = urls.slice(1 + detailCount).filter((url) => /^https:\/\//.test(url))
      return api.createActivity({
        title: d.title.trim(),
        campus: d.campus,
        signupStart,
        signupEnd,
        activityStart,
        activityEnd,
        location: d.location.trim(),
        address: d.address.trim(),
        coverUrl,
        images: imageUrls,
        detailTitle: d.detailTitle.trim(),
        detailContent: d.detailContent.trim(),
        signupTitle: d.signupTitle.trim(),
        signupContent: d.signupContent.trim(),
        signupImages: signupImageUrls,
        capacity: Number.isInteger(capacityNum) && capacityNum > 0 ? capacityNum : 0
      })
    }).then((res) => {
      const auditStatus = res && res.auditStatus
      this.setData({ submitting: false, publishAuditStatus: auditStatus || '' })
      this.finishActivityPublish()
    }).catch((err) => {
      this.setData({ submitting: false })
      this.toast((err && err.message) || '发布失败，请重试')
    })
  },

  onShow() {
    this.refreshActivityPublishSubscribeEntry()
  },

  // ===== 顶部「订阅活动审核提醒」入口 =====
  // 与原「发布活动」按钮走同一个 activityPublish 触发组（activityAudit），
  // 逻辑复用 utils/subscribe.js 的统一封装，原有逻辑一概不动。
  // 显隐口径 entryVisible('activityPublish')：偏好已开且微信侧已授权才隐藏，
  // 因此在设置页关闭「活动审核通知」后入口会自动重新出现。
  refreshActivityPublishSubscribeEntry() {
    // 本地判定为「需要引导」时直接显示（不发额外请求）；
    // 本地认为「已订阅」时再复核一次服务端额度 —— 额度是「点一次允许发一条」，
    // 高频场景（评论/私信）极易用尽；用尽后必须让入口重新出现，否则用户无从重新订阅。
    if (typeof subscribe.entryVisibleAsync === 'function') {
      subscribe.entryVisibleAsync('activityPublish')
        .then((need) => this.setData({ showActivityPublishSubscribeEntry: !!need, activityPublishSubscribeChecked: false }))
        .catch(() => {})
      return
    }
    const visible = typeof subscribe.entryVisible === 'function' ? subscribe.entryVisible('activityPublish') : false
    this.setData({ showActivityPublishSubscribeEntry: !!visible, activityPublishSubscribeChecked: false })
  },
  // 点击整行（左半区）与拨动开关走同一条路径
  onActivityPublishSubscribeTap(e) {
    // 开关被拨到「关」时不申请授权，只回正视觉状态（入口在订阅生效后本就会整体隐藏）
    if (e && e.detail && e.detail.value === false) { this.setData({ activityPublishSubscribeChecked: false }); return }
    this.setData({ activityPublishSubscribeChecked: true })
    if (typeof subscribe.requestEntryByTap !== 'function') { this.refreshActivityPublishSubscribeEntry(); return }
    // 必须在 tap 同步链内进入原生 API；requestEntryByTap = requestTriggerByTap + 允许后写偏好
    subscribe.requestEntryByTap('activityPublish')
      .then(() => this.refreshActivityPublishSubscribeEntry())
      .catch(() => this.refreshActivityPublishSubscribeEntry())
  },

  finishActivityPublish() {
    wx.showToast({
      title: this.data.publishAuditStatus === 'pending' ? '已提交审核' : '发布成功',
      icon: 'success',
      duration: 1200
    })
    setTimeout(() => {
      wx.navigateBack({
        fail: () => wx.redirectTo({ url: '/pkg-feature/pages/activity/index' })
      })
    }, 1100)
  }
})
