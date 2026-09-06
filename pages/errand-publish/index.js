const auth = require('../../utils/auth')
const request = require('../../utils/request')
const api = require('../../utils/api')
const wechat = require('../../utils/wechat')
const { runPullDownRefresh } = require('../../utils/refresh')
const LAST_FORM_KEY = 'errand_last_form'

// 发布页顶部轮播横幅：管理后台未配置时的本地默认（可在后台「内容配置-发布横幅」维护）
const DEFAULT_PUBLISH_BANNERS = [
  { id: 'default-1', text: '禁止引导私下交易，违规封禁！', icon: '🚫', style: 'red' },
  { id: 'default-2', text: '吃好喝好没烦恼。', icon: '😄', style: 'green' }
]

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    title: '',
    privateInfo: '',
    wechatId: '',
    useLastContact: false,
    // 收件信息
    campusGroups: [
      { name: '广州校区', campuses: ['新港校区', '琶洲校区'] },
      { name: '佛山校区', campuses: ['南海南校区', '南海北校区'] }
    ],
    activeCampus: -1,
    subCampuses: [],
    activeSubCampus: '',
    receiverName: '',
    receiverPhone: '',
    orderTypes: ['外卖', '快递', '帮买物品', '文件资料', '其他'],
    activeOrderType: 1,
    genderRestrictions: ['限男生', '限女生', '不限性别'],
    activeGenderRestriction: -1,
    // 地址与时间

    // 备注凭证
    remark: '',
    images: [],
    maxImages: 3,
    // 金额
    baseAmount: '',
    totalAmount: '',
    isLargeItem: false,
    isUrgent: false,
    // 期望完成时间（手动填写）
    appointmentValue: '',
    agreed: false,
    submitting: false,
    publishBanners: DEFAULT_PUBLISH_BANNERS.slice()
  },

  onLoad() {
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, navBarHeight: app.globalData.navBarHeight || 44 })
    if (!auth.requireLogin('发布跑腿需要先登录')) {
      setTimeout(() => wx.navigateBack(), 500)
    }
    this.loadPublishBanners()
    // 自动填充个人设置中选择的校区
    this.applyProfileCampus()
  },

  // ===== 顶部轮播横幅 =====
  loadPublishBanners() {
    api.getHomeConfig().then((config) => {
      const list = (config.publishBanners || []).map((b, i) => ({
        id: b.id || 'b' + i,
        text: b.text,
        style: b.style || 'red',
        icon: b.icon || ''
      }))
      if (list.length) this.setData({ publishBanners: list })
    }).catch(() => {})
  },
  onClosePublishBanner(e) {
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.publishBanners.slice()
    list.splice(index, 1)
    this.setData({ publishBanners: list })
  },

  // 根据个人设置（userInfo.campus）自动选中校区分组与具体校区
  applyProfileCampus() {
    const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {}
    const campus = userInfo.campus
    if (!campus) return
    const index = this.data.campusGroups.findIndex((group) => group.campuses.indexOf(campus) > -1)
    if (index < 0) return
    this.setData({
      activeCampus: index,
      subCampuses: this.data.campusGroups[index].campuses,
      activeSubCampus: campus
    })
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  },

  // 输入处理
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  goBack() { wx.navigateBack() },

  // ===== 使用上次：开关打开时，从本地存储读取上次成功发布的表单信息并填充 =====
  getLastForm() {
    return wx.getStorageSync(LAST_FORM_KEY) || null
  },

  onToggleLastContact(e) {
    const on = !!e.detail.value
    this.setData({ useLastContact: on })
    if (!on) return
    const last = this.getLastForm()
    if (!last || (!last.wechatId && !last.receiverPhone)) {
      wx.showToast({ title: '暂无上次的联系方式', icon: 'none' })
      this.setData({ useLastContact: false })
      return
    }
    this.setData({ wechatId: last.wechatId || '', receiverPhone: last.receiverPhone || '' })
  },

  // 发布成功后记录本次表单，供“使用上次”填充
  _saveLastForm() {
    const d = this.data
    wx.setStorageSync(LAST_FORM_KEY, {
      wechatId: d.wechatId.trim(),
      receiverPhone: d.receiverPhone.trim()
    })
  },

  // 基础金额输入（整数，不低于2）
  onBaseAmountInput(e) {
    let val = e.detail.value.replace(/\D/g, '')
    if (val === '') {
      this.setData({ baseAmount: '', totalAmount: '' })
      return
    }
    let num = parseInt(val, 10)
    if (num < 2) num = 2
    this.setData({ baseAmount: String(num) })
    this._recalcTotal()
  },

  // 下单类型选择
  onOrderTypeSelect(e) {
    this.setData({ activeOrderType: Number(e.currentTarget.dataset.index) })
  },

  // 校区选择
  onCampusSelect(e) {
    const activeCampus = Number(e.currentTarget.dataset.index)
    const group = this.data.campusGroups[activeCampus]
    this.setData({
      activeCampus,
      subCampuses: group ? group.campuses : [],
      activeSubCampus: ''
    })
  },

  onSubCampusSelect(e) {
    this.setData({ activeSubCampus: e.currentTarget.dataset.value })
  },

  // 性别限制选择
  onGenderRestrictionSelect(e) {
    this.setData({ activeGenderRestriction: Number(e.currentTarget.dataset.index) })
  },


  // 大件物品开关
  onToggleLargeItem() {
    this.setData({ isLargeItem: !this.data.isLargeItem })
    this._recalcTotal()
  },

  // 加急服务开关
  onToggleUrgent() {
    this.setData({ isUrgent: !this.data.isUrgent })
    this._recalcTotal()
  },

  // ===== 自动填充选项：点击将标签模板追加到对应输入框，已存在则不重复添加 =====
  onQuickTagTap(e) {
    const { field, tag } = e.currentTarget.dataset
    const current = String(this.data[field] || '')
    if (current.indexOf(tag) > -1) {
      wx.showToast({ title: '已添加过该选项', icon: 'none' })
      return
    }
    const trimmed = current.replace(/\s+$/, '')
    this.setData({ [field]: (trimmed ? trimmed + '\n' : '') + tag })
  },

  // 重新计算总金额
  _recalcTotal() {
    const base = parseInt(this.data.baseAmount, 10)
    if (!base) {
      this.setData({ totalAmount: '' })
      return
    }
    const largeFee = this.data.isLargeItem ? 1 : 0
    const urgentFee = this.data.isUrgent ? 1 : 0
    this.setData({ totalAmount: String(base + largeFee + urgentFee) })
  },

  // 上传图片
  onChooseImage() {
    const remain = this.data.maxImages - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = res.tempFiles.map((f) => f.tempFilePath)
        this.setData({
          images: [...this.data.images, ...paths]
        })
      }
    })
  },

  // 删除图片
  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  // 预览图片
  onPreviewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.previewImage({
      current: this.data.images[index],
      urls: this.data.images
    })
  },

  // 计算费用
  getFeeDetail() {
    const base = parseInt(this.data.baseAmount) || 2
    const largeFee = this.data.isLargeItem ? 1 : 0
    const urgentFee = this.data.isUrgent ? 1 : 0
    const total = base + largeFee + urgentFee
    return {
      baseAmount: base.toFixed(2),
      total: total.toFixed(2)
    }
  },

  // ===== 发单系统协议 =====
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  openAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index?type=errand' })
  },

  // 发布并支付
  onSubmit() {
    const { title, remark, baseAmount, wechatId, receiverPhone } = this.data
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意发单系统协议', icon: 'none' })
      return
    }
    if (!title || !title.trim()) { wx.showToast({ title: '请填写标题', icon: 'none' }); return }
    if (!remark.trim()) {
      wx.showToast({ title: '请填写公开描述', icon: 'none' })
      return
    }
    if (!this.data.appointmentValue.trim()) {
      wx.showToast({ title: '请填写期望完成时间', icon: 'none' })
      return
    }
    const baseNum = parseInt(baseAmount) || 0
    if (baseNum < 2 || baseNum > 500) {
      wx.showToast({ title: '金额需为2-500元', icon: 'none' })
      return
    }
    if (!wechatId.trim() && !receiverPhone.trim()) {
      wx.showToast({ title: '请填写微信号或手机号', icon: 'none' })
      return
    }
    if (receiverPhone.trim() && !/^1[3-9]\d{9}$/.test(receiverPhone.trim())) {
      wx.showToast({ title: '请输入正确的11位手机号', icon: 'none' })
      return
    }
    if (this.data.activeGenderRestriction < 0) {
      wx.showToast({ title: '请选择性别限制', icon: 'none' })
      return
    }
    if (this.data.activeCampus < 0) {
      wx.showToast({ title: '请选择校区', icon: 'none' })
      return
    }
    if (this.data.subCampuses.length && !this.data.activeSubCampus) {
      wx.showToast({ title: '请选择具体校区', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })

    const fee = this.getFeeDetail()
    const payload = {
      title: title.trim(),
      type: this.data.orderTypes[this.data.activeOrderType],
      campus: this.data.activeSubCampus || this.data.campusGroups[this.data.activeCampus].name,
      genderRequirement: this.data.genderRestrictions[this.data.activeGenderRestriction],
      receiverName: this.data.receiverName.trim() || '待联系',
      receiverPhone: receiverPhone.trim() || this.data.wechatId.trim(),
      pickupAddr: '',
      deliveryAddr: '',
      deliveryBuilding: '',
      deliveryRoom: '',
      pickupTimeType: '预约',
      appointmentTime: this.data.appointmentValue.trim(),
      remark: remark.trim(),
      privateInfo: this.data.privateInfo.trim(),
      wechatId: this.data.wechatId.trim(),
      images: this.data.images,
      baseAmount: parseFloat(fee.baseAmount),
      totalAmount: parseFloat(fee.total),
      isLargeItem: this.data.isLargeItem,
      isUrgent: this.data.isUrgent
    }

    if (request.USE_MOCK) {
      const mock = require('../../utils/mock')
      const order = Object.assign(
        {
          id: Date.now(),
          status: 'pending',
          publisherName: '我',
          role: 'publisher',
          createdAt: new Date().toISOString()
        },
        payload
      )
      mock.myPublishedOrders.unshift(order)
      mock.errandOrders.unshift(order)
      this._saveLastForm()
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
      this.setData({ submitting: false })
      return
    }

    // 真实模式：先将本地临时图片上传到服务器，再携带图片 URL 创建订单
    const uploadImages = this.data.images.length
      ? wechat.uploadImages(this.data.images)
      : Promise.resolve([])

    uploadImages.then((images) => {
      payload.images = images
      return request.post('/errand', payload, true, { silent: true })
    }).then((order) => {
      return request.post('/errand/' + order.id + '/pay', {}, true, {
        silent: true,
        idempotencyKey: 'errand_pay_' + order.id
      }).then((payment) => new Promise((resolve, reject) => wx.requestPayment({
        ...payment,
        success: resolve,
        fail: reject
      }))).then(() => this.waitForPaymentStatus(order.id))
    }).then(() => {
      this._saveLastForm()
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
    }).catch((error) => {
      const message = String((error && (error.errMsg || error.message)) || '')
      wx.showToast({ title: /cancel/.test(message) ? '已取消支付' : '支付未完成', icon: 'none' })
    }).finally(() => {
      this.setData({ submitting: false })
    })
  },

  async waitForPaymentStatus(orderId) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const data = await request.get('/errand/' + orderId + '/payment-status', {}, true, { silent: true, retries: 0 })
      if (data.status === 'SUCCESS') return data
      if (data.status === 'CLOSED') throw new Error('payment closed')
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
    throw new Error('payment pending')
  },

  onSubTab(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === 0) {
      wx.switchTab({ url: '/pages/errand/index' })
    } else if (index === 2) {
      wx.navigateTo({ url: '/pages/errand-order/index' })
    }
  }
})
