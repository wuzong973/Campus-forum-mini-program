const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

const MOCK_KEY = 'repair_mock_orders'

const DEFAULT_TECHNICIANS = [
  { name: '莫旭卿', phone: '19200444855', userId: null, chatAvailable: false },
  { name: '冯广兴', phone: '13450662913', userId: null, chatAvailable: false },
  { name: '蒋文鑫', phone: '15314270546', userId: null, chatAvailable: false },
  { name: '张彬浩', phone: '13543233827', userId: null, chatAvailable: false },
  { name: '欧阳文展', phone: '13726084801', userId: null, chatAvailable: false }
]

function today(offset) {
  const date = new Date(Date.now() + (offset || 0) * 86400000)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

Page({
  data: {
    tab: 'book',
    deviceTypes: ['数码电子', '家具家电', '日常器物', '其他设备'],
    deviceType: '数码电子',
    // Keep the displayed reservation fee aligned with the server-side price source.
    price: '0.99',
    contactName: '', contactPhone: '', serviceAddress: '', description: '',
    date: today(1), minDate: today(0), time: '14:00',
    technicians: DEFAULT_TECHNICIANS, selectedTechnician: null, selectedTechnicianPhone: '',
    images: [], orders: [], loadingOrders: false, submitting: false,
    statusText: { unpaid: '待支付', paid: '待接单', accepted: '已接单', repairing: '维修中', finished: '已完成', cancelled: '已取消' }
  },

  onLoad() {
    const profile = wx.getStorageSync('userInfo') || {}
    this.setData({ contactName: profile.realName || profile.nickName || '', contactPhone: profile.phone || '' })
    this.loadTechnicians()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadOrders())
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    if (tab === 'orders') this.loadOrders()
  },

  onSelect(e) {
    const field = e.currentTarget.dataset.field
    const value = e.currentTarget.dataset.value
    this.setData({ [field]: value })
  },

  onSelectTechnician(e) {
    const phone = e.currentTarget.dataset.phone
    const selectedTechnician = this.data.technicians.find((item) => item.phone === phone)
    if (selectedTechnician) this.setData({ selectedTechnician, selectedTechnicianPhone: phone })
  },

  onChatTechnician(e) {
    const phone = e.currentTarget.dataset.phone
    const technician = this.data.technicians.find((item) => item.phone === phone)
    if (!technician || !technician.userId) {
      wx.showToast({ title: '该维修人员暂未开通小程序聊天', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/chat/index?peerId=' + technician.userId +
        '&nick=' + encodeURIComponent(technician.name) +
        '&avatar=' + encodeURIComponent('/assets/icons/repair-logo.jpg')
    })
  },

  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  onDateChange(e) { this.setData({ date: e.detail.value }) },
  onTimeChange(e) { this.setData({ time: e.detail.value }) },

  onChooseLocation() {
    wx.chooseLocation({ success: (res) => this.setData({ serviceAddress: res.name || res.address }) })
  },

  onFillCommonAddr() {
    const commonAddr = wx.getStorageSync('common_address') || ''
    if (!commonAddr) {
      wx.showToast({ title: '请先在设置中填写常用地址', icon: 'none' })
      return
    }
    this.setData({ serviceAddress: commonAddr })
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 3 - this.data.images.length,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => this.setData({ images: this.data.images.concat(res.tempFiles.map((item) => item.tempFilePath)) })
    })
  },

  onRemoveImage(e) {
    const images = this.data.images.slice()
    images.splice(Number(e.currentTarget.dataset.index), 1)
    this.setData({ images })
  },

  validate() {
    if (!this.data.contactName.trim()) return '请填写联系人'
    if (!/^1\d{10}$/.test(this.data.contactPhone)) return '请填写正确的手机号'
    if (!this.data.serviceAddress.trim()) return '请填写上门地址'
    if (!this.data.description.trim()) return '请描述故障问题'
    if (!this.data.selectedTechnician) return '请选择要预约的维修人员'
    return ''
  },

  uploadImages() {
    const token = getApp().globalData.token || wx.getStorageSync('token') || ''
    return Promise.all(this.data.images.map((filePath) => new Promise((resolve, reject) => {
      wx.uploadFile({
        url: request.BASE_URL + '/user/upload/image', filePath, name: 'file',
        header: { Authorization: 'Bearer ' + token },
        success(res) {
          try {
            const body = JSON.parse(res.data)
            if (res.statusCode === 200 && body.code === 200) resolve(body.data.url)
            else reject(new Error(body.message || '图片上传失败'))
          } catch (e) { reject(e) }
        },
        fail: reject
      })
    })))
  },

  async onSubmit() {
    const error = this.validate()
    if (error) return wx.showToast({ title: error, icon: 'none' })
    if (this.data.submitting) return
    this.setData({ submitting: true })
    const payload = {
      deviceType: this.data.deviceType,
      contactName: this.data.contactName.trim(), contactPhone: this.data.contactPhone,
      serviceAddress: this.data.serviceAddress.trim(), description: this.data.description.trim(),
      appointmentTime: `${this.data.date}T${this.data.time}:00+08:00`,
      technicianPhone: this.data.selectedTechnician.phone,
      technicianName: this.data.selectedTechnician.name,
      technicianUserId: this.data.selectedTechnician.userId || null,
      images: []
    }
    try {
      if (request.USE_MOCK) {
        await new Promise((resolve, reject) => wx.showModal({
          title: '模拟支付', content: `需支付 ¥${this.data.price}，开发模式下将模拟支付成功。`,
          success: (res) => res.confirm ? resolve() : reject(new Error('cancel'))
        }))
        const orders = wx.getStorageSync(MOCK_KEY) || []
        orders.unshift({ id: Date.now(), order_no: `MOCK${Date.now()}`, ...payload, amount: this.data.price, status: 'paid', appointment_time: `${this.data.date} ${this.data.time}` })
        wx.setStorageSync(MOCK_KEY, orders)
      } else {
        payload.images = await this.uploadImages()
        const order = await request.post('/repair/orders', payload, true, { showLoading: '正在创建订单' })
        const payment = await request.post(`/repair/orders/${order.id}/pay`, {}, true, { idempotencyKey: `repair_pay_${order.id}` })
        await new Promise((resolve, reject) => wx.requestPayment({ ...payment, success: resolve, fail: reject }))
        await this.waitForPaymentStatus(order.id)
      }
      wx.showToast({ title: '预约支付成功', icon: 'success' })
      this.setData({ tab: 'orders', description: '', images: [] })
      this.loadOrders()
    } catch (e) {
      if (!e || String(e.errMsg || e.message).indexOf('cancel') === -1) wx.showToast({ title: '支付未完成', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async waitForPaymentStatus(orderId) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const data = await request.get(`/repair/orders/${orderId}/payment-status`, {}, true, { silent: true, retries: 0 })
      if (data.status === 'SUCCESS') return data
      if (data.status === 'CLOSED') throw new Error('payment closed')
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
    throw new Error('payment pending')
  },

  async loadOrders() {
    this.setData({ loadingOrders: true })
    try {
      const orders = request.USE_MOCK ? (wx.getStorageSync(MOCK_KEY) || []) : await request.get('/repair/orders', {}, true)
      this.setData({ orders })
    } finally {
      this.setData({ loadingOrders: false })
    }
  },

  async loadTechnicians() {
    if (request.USE_MOCK) return
    try {
      const technicians = await request.get('/repair/technicians', {}, true, { silent: true })
      if (Array.isArray(technicians) && technicians.length) this.setData({ technicians })
    } catch (e) {
      // 保留本地登记名单，确保接口暂不可用时仍可完成页面填写。
    }
  }
})
