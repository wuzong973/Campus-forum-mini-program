const auth = require('../../utils/auth')
const request = require('../../utils/request')
const wechat = require('../../utils/wechat')
const { runPullDownRefresh } = require('../../utils/refresh')
const COMMON_ADDR_KEY = 'common_address'
const LAST_FORM_KEY = 'errand_last_form'

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    title: '',
    privateInfo: '',
    wechatId: '',
    useLastContact: false,
    useLastPickup: false,
    useLastDelivery: false,
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
    pickupAddr: '',
    deliveryAddr: '',
    deliveryBuilding: '',
    deliveryRoom: '',

    // 备注凭证
    remark: '',
    images: [],
    maxImages: 3,
    // 金额
    baseAmount: '',
    totalAmount: '',
    isLargeItem: false,
    isUrgent: false,
    pickupTimeType: '尽快',
    appointmentPickerRange: [[], [], []],
    appointmentDateIndex: 0,
    appointmentHourIndex: 0,
    appointmentMinuteIndex: 0,
    appointmentTime: '',
    appointmentValue: '',
    submitting: false,
    // 常用地址
    commonAddress: ''
  },

  onLoad() {
    const app = getApp()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, navBarHeight: app.globalData.navBarHeight || 44 })
    if (!auth.requireLogin('发布跑腿需要先登录')) {
      setTimeout(() => wx.navigateBack(), 500)
    }
    this.setData({ commonAddress: wx.getStorageSync(COMMON_ADDR_KEY) || '' })
    this.initAppointmentPicker()
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

  onToggleLastPickup(e) {
    const on = !!e.detail.value
    this.setData({ useLastPickup: on })
    if (!on) return
    const last = this.getLastForm()
    if (!last || !last.pickupAddr) {
      wx.showToast({ title: '暂无上次的取件信息', icon: 'none' })
      this.setData({ useLastPickup: false })
      return
    }
    this.setData({ pickupAddr: last.pickupAddr })
  },

  onToggleLastDelivery(e) {
    const on = !!e.detail.value
    this.setData({ useLastDelivery: on })
    if (!on) return
    const last = this.getLastForm()
    if (!last || !last.deliveryAddr) {
      wx.showToast({ title: '暂无上次的送达信息', icon: 'none' })
      this.setData({ useLastDelivery: false })
      return
    }
    const activeCampus = Number(last.activeCampus)
    const group = this.data.campusGroups[activeCampus]
    this.setData({
      deliveryAddr: last.deliveryAddr,
      deliveryBuilding: last.deliveryBuilding || '',
      deliveryRoom: last.deliveryRoom || '',
      activeCampus: group ? activeCampus : -1,
      subCampuses: group ? group.campuses : [],
      activeSubCampus: last.activeSubCampus || ''
    })
  },

  // 发布成功后记录本次表单，供“使用上次”填充
  _saveLastForm() {
    const d = this.data
    wx.setStorageSync(LAST_FORM_KEY, {
      pickupAddr: d.pickupAddr.trim(),
      deliveryAddr: d.deliveryAddr.trim(),
      deliveryBuilding: d.deliveryBuilding.trim(),
      deliveryRoom: d.deliveryRoom.trim(),
      activeCampus: d.activeCampus,
      activeSubCampus: d.activeSubCampus,
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

  // ===== 期望完成时间选择器（今天/明天 + 时 + 分，5分钟间隔） =====
  // 纯函数：根据选中索引构建三列数据，今天从当前时间起可选，已过时段不进入列表
  buildTimeColumns(dateIndex, hourIndex, minuteIndex) {
    const now = new Date()
    const labels = ['今天', '明天']
    const dates = []
    for (let offset = 0; offset < 2; offset++) {
      // 今天：当前时间 +5 分钟已超过当天最后时段（23:55）则整天不可选，自动只剩明天
      if (offset === 0) {
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 55)
        if (now.getTime() + 5 * 60 * 1000 > dayEnd.getTime()) continue
      }
      dates.push({ value: this.formatDateValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)), label: labels[offset] + ' ' + this.formatDateLabel(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)) })
    }
    const safeDateIndex = Math.min(Math.max(dateIndex, 0), Math.max(dates.length - 1, 0))
    const date = dates[safeDateIndex]
    const todayValue = this.formatDateValue(now)
    const isToday = date && date.value === todayValue
    // 小时列：今天从当前小时开始，明天从 00 时开始
    const startHour = isToday ? now.getHours() : 0
    const hours = []
    for (let h = startHour; h < 24; h++) hours.push(String(h).padStart(2, '0') + '时')
    const safeHourIndex = Math.min(Math.max(hourIndex, 0), Math.max(hours.length - 1, 0))
    const selectedHour = startHour + safeHourIndex
    // 分钟列：今天当前小时内从当前时间向上取整到 5 分钟格点，其余整点从 00 分开始
    let startMinute = 0
    if (isToday && selectedHour === now.getHours()) startMinute = Math.ceil(now.getMinutes() / 5) * 5
    const minutes = []
    for (let m = startMinute; m < 60; m += 5) minutes.push(String(m).padStart(2, '0') + '分')
    const safeMinuteIndex = Math.min(Math.max(minuteIndex, 0), Math.max(minutes.length - 1, 0))
    return { dates, hours, minutes, dateIndex: safeDateIndex, hourIndex: safeHourIndex, minuteIndex: safeMinuteIndex }
  },

  initAppointmentPicker() {
    const cols = this.buildTimeColumns(0, 0, 0)
    this.setData({
      appointmentPickerRange: [cols.dates.map((item) => item.label), cols.hours, cols.minutes],
      appointmentDateIndex: cols.dateIndex,
      appointmentHourIndex: cols.hourIndex,
      appointmentMinuteIndex: cols.minuteIndex
    })
  },

  formatDateValue(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
  },

  formatDateLabel(date) {
    return String(date.getMonth() + 1).padStart(2, '0') + '月' + String(date.getDate()).padStart(2, '0') + '日'
  },

  onPickupTimeTypeSelect(e) {
    this.setData({ pickupTimeType: e.currentTarget.dataset.type })
  },

  // 列变化：仅刷新列数据与合法索引，不落定最终选择
  onAppointmentColumnChange(e) {
    const { column, value } = e.detail
    const dateIndex = column === 0 ? value : this.data.appointmentDateIndex
    const hourIndex = column === 1 ? value : this.data.appointmentHourIndex
    const minuteIndex = column === 2 ? value : this.data.appointmentMinuteIndex
    const cols = this.buildTimeColumns(dateIndex, hourIndex, minuteIndex)
    this.setData({
      appointmentPickerRange: [cols.dates.map((item) => item.label), cols.hours, cols.minutes],
      appointmentDateIndex: cols.dateIndex,
      appointmentHourIndex: cols.hourIndex,
      appointmentMinuteIndex: cols.minuteIndex
    })
  },

  // 确认选择：落定最终时间
  onAppointmentChange(e) {
    const value = e.detail.value || []
    const cols = this.buildTimeColumns(value[0] || 0, value[1] || 0, value[2] || 0)
    const date = cols.dates[cols.dateIndex]
    if (!date || !cols.hours.length || !cols.minutes.length) return
    const hour = String(cols.dateIndex >= 0 ? parseInt(cols.hours[cols.hourIndex], 10) : 0).padStart(2, '0')
    const minute = String(parseInt(cols.minutes[cols.minuteIndex], 10)).padStart(2, '0')
    this.setData({
      pickupTimeType: '预约',
      appointmentPickerRange: [cols.dates.map((item) => item.label), cols.hours, cols.minutes],
      appointmentDateIndex: cols.dateIndex,
      appointmentHourIndex: cols.hourIndex,
      appointmentMinuteIndex: cols.minuteIndex,
      appointmentTime: date.value + ' ' + hour + ':' + minute + ':00',
      appointmentValue: date.label + ' ' + hour + ':' + minute
    })
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

  // 填入常用地址
  onFillCommonAddr() {
    const addr = wx.getStorageSync(COMMON_ADDR_KEY) || ''
    if (!addr) {
      wx.showToast({ title: '请先在设置中填写常用地址', icon: 'none' })
      return
    }
    this.setData({ deliveryAddr: addr })
  },

  // 地图辅助定位
  onChooseLocation(e) {
    const target = e.currentTarget.dataset.target
    wx.chooseLocation({
      success: (res) => {
        if (res.name || res.address) {
          const addr = res.name || res.address
          this.setData({ [target]: addr })
        }
      },
      fail: (err) => {
        // 用户取消不提示，其他错误提示
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '定位失败，请手动输入', icon: 'none' })
        }
      }
    })
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

  // 发布并支付
  onSubmit() {
    const { receiverName, receiverPhone, pickupAddr, deliveryAddr, deliveryBuilding, deliveryRoom, remark, baseAmount, title } = this.data
    if (!title || !title.trim()) { wx.showToast({ title: '请填写标题', icon: 'none' }); return }
    if (!remark.trim()) {
      wx.showToast({ title: '请填写备注信息', icon: 'none' })
      return
    }
    if (!pickupAddr.trim()) { wx.showToast({ title: '请填写取件地址', icon: 'none' }); return }
    if (!deliveryAddr.trim()) { wx.showToast({ title: '请填写送达地址', icon: 'none' }); return }
    if (!deliveryBuilding.trim()) { wx.showToast({ title: '请填写楼栋', icon: 'none' }); return }
    if (!deliveryRoom.trim()) { wx.showToast({ title: '请填写宿舍号', icon: 'none' }); return }
    const genderIndex = this.data.activeGenderRestriction < 0 ? 2 : this.data.activeGenderRestriction
    if (this.data.activeGenderRestriction < 0) this.setData({ activeGenderRestriction: genderIndex })

    const baseNum = parseInt(baseAmount) || 0
    if (baseNum < 2 || baseNum > 500) {
      wx.showToast({ title: '金额需为2-500元', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })

    const fee = this.getFeeDetail()
    const payload = {
      title: title.trim(),
      type: this.data.orderTypes[this.data.activeOrderType],
      campus: this.data.activeSubCampus || '不限校区',
      genderRequirement: this.data.genderRestrictions[genderIndex],
      receiverName: receiverName.trim() || '待联系',
      receiverPhone: receiverPhone.trim() || this.data.wechatId.trim(),
      pickupAddr: pickupAddr.trim(),
      deliveryAddr: deliveryAddr.trim(),
      deliveryBuilding: deliveryBuilding.trim(),
      deliveryRoom: deliveryRoom.trim(),
      pickupTimeType: this.data.pickupTimeType,
      appointmentTime: this.data.pickupTimeType === '预约' ? this.data.appointmentTime : '',
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
