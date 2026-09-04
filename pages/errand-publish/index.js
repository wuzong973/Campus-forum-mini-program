const auth = require('../../utils/auth')
const request = require('../../utils/request')
const wechat = require('../../utils/wechat')
const COMMON_ADDR_KEY = 'common_address'

Page({
  data: {
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
    appointmentDates: [],
    appointmentDateOptions: [],
    appointmentTimeOptions: [],
    appointmentPickerRange: [[], []],
    appointmentDateIndex: 0,
    appointmentTimeIndex: 0,
    appointmentTime: '',
    appointmentValue: '',
    submitting: false,
    // 常用地址
    commonAddress: ''
  },

  onLoad() {
    if (!auth.requireLogin('发布跑腿需要先登录')) {
      setTimeout(() => wx.navigateBack(), 500)
    }
    this.setData({ commonAddress: wx.getStorageSync(COMMON_ADDR_KEY) || '' })
    this.initAppointmentPicker()
  },

  // 输入处理
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  // 基础金额输入（整数，不低于2）
  onBaseAmountInput(e) {
    let val = e.detail.value.replace(/\D/g, '')
    if (val === '') {
      this.setData({ baseAmount: '', totalAmount: '' })
      return
    }
    const num = parseInt(val, 10)
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

  initAppointmentPicker() {
    const now = new Date()
    const appointmentDates = []
    const dateLabels = ['今天', '明天', '后天']
    for (let offset = 0; offset < 3; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
      const slots = this.getAppointmentSlots(date, offset === 0 ? now : null)
      if (slots.length) {
        appointmentDates.push({
          value: this.formatDateValue(date),
          label: dateLabels[offset] + ' ' + this.formatDateLabel(date),
          slots
        })
      }
    }
    const first = appointmentDates[0] || { slots: [] }
    this.setData({
      appointmentDates,
      appointmentDateOptions: appointmentDates.map((item) => item.label),
      appointmentTimeOptions: first.slots,
      appointmentPickerRange: [appointmentDates.map((item) => item.label), first.slots],
      appointmentDateIndex: 0,
      appointmentTimeIndex: 0
    })
  },

  getAppointmentSlots(date, now) {
    const slots = []
    let startMinutes = 0
    if (now) {
      startMinutes = now.getHours() * 60 + now.getMinutes()
      startMinutes = Math.ceil(startMinutes / 30) * 30
    }
    for (let minutes = startMinutes; minutes < 24 * 60; minutes += 30) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, '0')
      const minute = String(minutes % 60).padStart(2, '0')
      slots.push(hour + ':' + minute)
    }
    return slots
  },

  formatDateValue(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
  },

  formatDateLabel(date) {
    return date.getFullYear() + '年' + String(date.getMonth() + 1).padStart(2, '0') + '月' + String(date.getDate()).padStart(2, '0') + '日'
  },

  onPickupTimeTypeSelect(e) {
    this.setData({ pickupTimeType: e.currentTarget.dataset.type })
  },

  onAppointmentColumnChange(e) {
    if (e.detail.column !== 0) return
    const dateIndex = e.detail.value
    const date = this.data.appointmentDates[dateIndex]
    const slots = date ? date.slots : []
    this.setData({
      appointmentDateIndex: dateIndex,
      appointmentTimeIndex: 0,
      appointmentTimeOptions: slots,
      appointmentPickerRange: [this.data.appointmentDateOptions, slots]
    })
  },

  onAppointmentChange(e) {
    const indices = e.detail.value
    const date = this.data.appointmentDates[indices[0]]
    const time = date && date.slots[indices[1]]
    if (!date || !time) return
    const appointmentTime = date.value + ' ' + time + ':00'
    this.setData({
      pickupTimeType: '预约',
      appointmentDateIndex: indices[0],
      appointmentTimeIndex: indices[1],
      appointmentTime,
      appointmentValue: '预约 ' + this.formatDateLabel(new Date(date.value + 'T00:00:00')) + ' ' + time
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
    const { receiverName, receiverPhone, pickupAddr, deliveryAddr, deliveryBuilding, deliveryRoom, remark, baseAmount } = this.data
    if (this.data.activeCampus < 0 || !this.data.activeSubCampus) {
      wx.showToast({ title: '请选择校区', icon: 'none' })
      return
    }
    if (!receiverName.trim()) {
      wx.showToast({ title: '请填写收件人姓名', icon: 'none' })
      return
    }
    if (!receiverPhone.trim()) {
      wx.showToast({ title: '请填写联系方式', icon: 'none' })
      return
    }
    if (!pickupAddr.trim()) {
      wx.showToast({ title: '请填写取件地址', icon: 'none' })
      return
    }
    if (!deliveryAddr.trim()) {
      wx.showToast({ title: '请填写送达地址', icon: 'none' })
      return
    }
    if (!deliveryBuilding.trim()) {
      wx.showToast({ title: '请填写送达楼栋', icon: 'none' })
      return
    }
    if (!deliveryRoom.trim()) {
      wx.showToast({ title: '请填写宿舍号', icon: 'none' })
      return
    }
    if (!remark.trim()) {
      wx.showToast({ title: '请填写备注信息', icon: 'none' })
      return
    }
    if (this.data.activeGenderRestriction < 0) {
      wx.showToast({ title: '请选择性别限制', icon: 'none' })
      return
    }

    const baseNum = parseInt(baseAmount) || 0
    if (baseNum < 2) {
      wx.showToast({ title: '基础金额不能低于2元', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })

    const fee = this.getFeeDetail()
    const payload = {
      type: this.data.orderTypes[this.data.activeOrderType],
      campus: this.data.activeSubCampus,
      genderRequirement: this.data.genderRestrictions[this.data.activeGenderRestriction],
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      pickupAddr: pickupAddr.trim(),
      deliveryAddr: deliveryAddr.trim(),
      deliveryBuilding: deliveryBuilding.trim(),
      deliveryRoom: deliveryRoom.trim(),
      pickupTimeType: this.data.pickupTimeType,
      appointmentTime: this.data.pickupTimeType === '预约' ? this.data.appointmentTime : '',
      remark: remark.trim(),
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
