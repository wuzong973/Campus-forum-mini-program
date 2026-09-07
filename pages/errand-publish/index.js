const auth = require('../../utils/auth')
const request = require('../../utils/request')
const api = require('../../utils/api')
const wechat = require('../../utils/wechat')
const { runPullDownRefresh } = require('../../utils/refresh')
const LAST_FORM_KEY = 'errand_last_form'

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
    // 截止接单时间（可选）：到期无人接单自动取消并退款
    deadlineText: '',
    acceptDeadlineValue: null,
    showDeadlineSheet: false,
    deadlineDays: [],
    deadlineHours: [],
    deadlineMinutes: [],
    deadlinePickerValue: [0, 0, 0],
    agreed: false,
    submitting: false,
    publishBanners: []
  },

  onLoad() {
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, navBarHeight: app.globalData.navBarHeight || 44 })
    if (!auth.requireLogin('发布跑腿需要先登录')) {
      setTimeout(() => wx.navigateBack(), 500)
    }
    // 轮播横幅由 onShow 统一拉取（首次进入 onShow 也会触发）
    // 根据个人设置（个人中心校区）自动选中校区
    this.applyProfileCampus()
  },

  onShow() {
    // 管理员后台更新发布横幅样式后，再次进入发布页即可同步（onLoad 只走一次）
    this.loadPublishBanners()
  },

  // ===== 顶部轮播横幅 =====
  loadPublishBanners() {
    api.getHomeConfig().then((config) => {
      const list = (config.publishBanners || []).map((b, i) => ({
        id: b.id || 'b' + i,
        text: b.text,
        style: b.style || 'red',
        icon: b.icon || '',
        link: b.link || '',
        linkText: b.linkText || '',
        bannerStyle: (b.bgColor ? 'background:' + b.bgColor + ';' : '') + (b.textColor ? 'color:' + b.textColor + ';' : '')
      }))
      if (list.length) this.setData({ publishBanners: list })
    }).catch(() => {})
  },

  // 点击发布横幅：配置了跳转链接则按类型跳转，未配置则打开横幅详情页
  onPublishBannerTap(e) {
    const banner = this.data.publishBanners[Number(e.currentTarget.dataset.index)] || {}
    const link = String(banner.link || '').trim()
    if (/^https?:\/\//i.test(link)) {
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(link) + '&title=' + encodeURIComponent(banner.linkText || '公告详情')
      })
      return
    }
    if (link) {
      const path = link.charAt(0) === '/' ? link : '/' + link
      wx.navigateTo({
        url: path,
        fail: () => wx.switchTab({ url: path, fail: () => wx.navigateTo({ url: '/pages/banner-detail/index?scope=publish&id=' + (banner.id || '') }) })
      })
      return
    }
    wx.navigateTo({ url: '/pages/banner-detail/index?scope=publish&id=' + (banner.id || '') })
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

  // ===== 截止接单时间选择 =====
  // 模型：_deadlineSel 保存选中的「日期偏移 + 时 + 分」值；
  // 可选时分数组每次都按【当前时刻】动态重建——选「今天」时只保留当前时刻之后的选项
  //（最近的未来时刻 = 下一分钟），选其他日期则全天任意时间可选。
  onOpenDeadlineSheet() {
    const now = new Date()
    const dayNames = ['今天', '明天', '后天', '大后天']
    const days = dayNames.map((name, offset) => {
      const d = new Date(now.getTime() + offset * 86400000)
      return { offset, label: name + '(' + (d.getMonth() + 1) + '月' + d.getDate() + '日)' }
    })
    let sel
    if (this.data.acceptDeadlineValue) {
      // 已设置过则回显原选择
      const old = this.data.acceptDeadlineValue
      sel = { day: this._deadlineDayOffset(old, now), hour: old.getHours(), minute: old.getMinutes() }
    } else {
      // 默认初始可选时间：最近的未来时刻（下一分钟；23:59 的下一分钟进入下一小时）
      let hour = now.getHours()
      let minute = now.getMinutes() + 1
      if (minute > 59) { minute = 0; hour += 1 }
      sel = { day: 0, hour, minute }
    }
    this._deadlineSel = sel
    this.setData({ showDeadlineSheet: true, deadlineDays: days })
    this._applyDeadlineRange()
  },

  // 计算目标日期落在 今天(0)~大后天(3) 的偏移，越界则夹紧
  _deadlineDayOffset(date, now) {
    const a = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diff = Math.round((a.getTime() - b.getTime()) / 86400000)
    return Math.max(0, Math.min(diff, 3))
  },

  // 按当前时刻重建「可选时 / 可选分」数组，并夹紧当前选择值：
  // - 今天：小时从当前小时开始；若所选小时正是起始小时，分钟从下一分钟开始（当前分钟不可选，保证确认时必为未来时刻）
  // - 今天 23:59 之后进入下一小时，起始小时自动 +1（边界处理）
  // - 今天以外日期：0-23 时、0-59 分全量可选
  _applyDeadlineRange() {
    const sel = this._deadlineSel || { day: 0, hour: 0, minute: 0 }
    const now = new Date()
    const isToday = Number(sel.day) === 0
    let minHour = 0
    let minMinute = 0
    if (isToday) {
      minHour = now.getHours()
      minMinute = now.getMinutes() + 1
      if (minMinute > 59) { minMinute = 0; minHour += 1 }
    }
    const hours = []
    for (let h = Math.min(minHour, 23); h <= 23; h++) hours.push(h)
    if (!hours.length) hours.push(23)
    let hour = Number(sel.hour)
    if (!Number.isInteger(hour) || hour < hours[0]) hour = hours[0]
    if (hour > 23) hour = 23
    // 仅当今天且所选小时正是起始小时时，分钟受「下一分钟起」限制
    const minuteMin = isToday && hour === Math.min(minHour, 23) ? Math.min(minMinute, 59) : 0
    const minutes = []
    for (let m = minuteMin; m <= 59; m++) minutes.push(m)
    let minute = Number(sel.minute)
    if (!Number.isInteger(minute) || minute < minuteMin) minute = minuteMin
    if (minute > 59) minute = 59
    sel.hour = hour
    sel.minute = minute
    this.setData({
      deadlineHours: hours,
      deadlineMinutes: minutes,
      deadlinePickerValue: [Number(sel.day), Math.max(0, hours.indexOf(hour)), Math.max(0, minutes.indexOf(minute))]
    })
  },

  onDeadlinePickerChange(e) {
    const v = e.detail.value || []
    const sel = this._deadlineSel
    if (!sel) return
    sel.day = Number(v[0]) || 0
    const hours = this.data.deadlineHours
    const minutes = this.data.deadlineMinutes
    if (hours.length) sel.hour = hours[Math.min(Number(v[1]) || 0, hours.length - 1)]
    if (minutes.length) sel.minute = minutes[Math.min(Number(v[2]) || 0, minutes.length - 1)]
    // 实时用当前时刻重算可选范围：切到今天自动剔除已过去时刻，切到其他日期恢复全天可选；
    // 已选的时/分值在合法范围内尽量保留
    this._applyDeadlineRange()
  },

  onCloseDeadlineSheet() {
    this.setData({ showDeadlineSheet: false })
  },

  // 清空时间，不限时
  onDeadlineUnlimited() {
    this.setData({ deadlineText: '', acceptDeadlineValue: null, showDeadlineSheet: false })
  },

  // 字段上的「清除」快捷按钮
  onClearDeadline() {
    this.setData({ deadlineText: '', acceptDeadlineValue: null })
  },

  onConfirmDeadline() {
    const sel = this._deadlineSel
    if (!sel) { this.setData({ showDeadlineSheet: false }); return }
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(sel.day), Number(sel.hour), Number(sel.minute), 0)
    // 弹窗停留较久可能导致所选时刻刚过期：刷新可选范围并顺延到最近的未来时刻，让用户重新确认
    if (d.getTime() <= Date.now()) {
      wx.showToast({ title: '所选时间已过期，已重新刷新可选时间', icon: 'none' })
      this._applyDeadlineRange()
      return
    }
    const p = (n) => String(n).padStart(2, '0')
    const dayNames = ['今天', '明天', '后天', '大后天']
    this.setData({
      deadlineText: (dayNames[Number(sel.day)] || '') + ' ' + p(d.getMonth() + 1) + '月' + p(d.getDate()) + '日 ' + p(Number(sel.hour)) + ':' + p(Number(sel.minute)) + ' 前',
      acceptDeadlineValue: d,
      showDeadlineSheet: false
    })
  },

  // 截止接单时间 → 'YYYY-MM-DD HH:mm:00'（未设置返回 null）
  formatAcceptDeadline() {
    const d = this.data.acceptDeadlineValue
    if (!d) return null
    const p = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00'
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
      acceptDeadline: this.formatAcceptDeadline(),
      remark: remark.trim(),
      privateInfo: this.data.privateInfo.trim(),
      wechatId: this.data.wechatId.trim(),
      images: this.data.images,
      baseAmount: parseFloat(fee.baseAmount),
      totalAmount: parseFloat(fee.total),
      isLargeItem: this.data.isLargeItem,
      isUrgent: this.data.isUrgent
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
