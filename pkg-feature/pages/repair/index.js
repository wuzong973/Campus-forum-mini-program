const request = require('../../../utils/request')
const auth = require('../../../utils/auth')
const { runPullDownRefresh } = require('../../../utils/refresh')

// 「使用上次」保存的联系方式（与跑腿发布页同样的键名约定）
const LAST_CONTACT_KEY = 'repair_last_contact'

Page({
  data: {
    tab: 'book',
    contactName: '', contactPhone: '', serviceAddress: '', description: '',
    wechatId: '', useLastContact: false, expectedTime: '',
    technicians: [], selectedTechnician: null, selectedTechnicianPhone: '',
    images: [], orders: [], loadingOrders: false, submitting: false,
    statusText: { unpaid: '待支付', paid: '待接单', accepted: '已接单', repairing: '维修中', finished: '已完成', cancelled: '已取消' }
  },

  onLoad() {
    // 未登录：弹窗引导去登录（取消则退回），登录后回到本页在 onShow 补初始化
    if (!auth.guardPage('报修服务需要先登录')) return
    this._initialized = true
    this.initRepair()
  },

  onShow() {
    // 从登录页返回时补执行初始化（首次进入已在 onLoad 完成）
    if (this._initialized) return
    if (!auth.isLoggedIn()) return
    this._initialized = true
    this.initRepair()
  },

  initRepair() {
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

  onSelectTechnician(e) {
    const phone = e.currentTarget.dataset.phone
    // 再次点击已选中的维修人员 = 取消选择（不指定，由平台分配）
    if (this.data.selectedTechnicianPhone === phone) {
      this.setData({ selectedTechnician: null, selectedTechnicianPhone: '' })
      return
    }
    const selectedTechnician = this.data.technicians.find((item) => item.phone === phone)
    if (selectedTechnician) this.setData({ selectedTechnician, selectedTechnicianPhone: phone })
  },

  // 列表内的「复制」：把该维修人员的手机号写入系统剪贴板
  onCopyTechnicianPhone(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim()
    if (!phone) {
      wx.showToast({ title: '暂无可复制的手机号', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: phone,
      success: () => {
        // setClipboardData 成功后微信会自动弹「内容已复制」，无需再弹，避免重复提示
      },
      fail: () => {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' })
      }
    })
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

  // ===== 使用上次：开关打开时，读取本地保存的上次联系方式填入 =====
  onToggleLastContact(e) {
    const on = !!e.detail.value
    this.setData({ useLastContact: on })
    if (!on) return
    const last = wx.getStorageSync(LAST_CONTACT_KEY) || null
    if (!last || (!last.wechatId && !last.contactPhone)) {
      wx.showToast({ title: '暂无上次的联系方式', icon: 'none' })
      this.setData({ useLastContact: false })
      return
    }
    this.setData({
      wechatId: last.wechatId || '',
      contactPhone: last.contactPhone || '',
      contactName: this.data.contactName || last.contactName || ''
    })
  },

  saveLastContact() {
    wx.setStorageSync(LAST_CONTACT_KEY, {
      wechatId: this.data.wechatId.trim(),
      contactPhone: this.data.contactPhone.trim(),
      contactName: this.data.contactName.trim()
    })
  },

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
    if (!this.data.wechatId.trim()) return '请填写微信号'
    if (!this.data.serviceAddress.trim()) return '请填写上门地址'
    if (!this.data.description.trim()) return '请描述故障问题'
    if (!this.data.expectedTime.trim()) return '请填写期望上门时间'
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
    // 维修人员为选填：未选择时不带该字段，由后台统一分配
    const technician = this.data.selectedTechnician || null
    const payload = {
      deviceType: this.data.description.trim().slice(0, 20) || '维修设备',
      contactName: this.data.contactName.trim(), contactPhone: this.data.contactPhone,
      wechatId: this.data.wechatId.trim(),
      expectedTime: this.data.expectedTime.trim(),
      serviceAddress: this.data.serviceAddress.trim(), description: this.data.description.trim(),
      images: []
    }
    if (technician) {
      payload.technicianPhone = technician.phone
      payload.technicianName = technician.name
      payload.technicianUserId = technician.userId || null
    }
    try {
      payload.images = await this.uploadImages()
      const order = await request.post('/repair/orders', payload, true, { showLoading: '正在创建订单' })
      const payment = await request.post(`/repair/orders/${order.id}/pay`, {}, true, { idempotencyKey: `repair_pay_${order.id}` })
      await new Promise((resolve, reject) => wx.requestPayment({ ...payment, success: resolve, fail: reject }))
      await this.waitForPaymentStatus(order.id)
      this.saveLastContact()
      wx.showToast({ title: '预约支付成功', icon: 'success' })
      this.setData({ tab: 'orders', description: '', expectedTime: '', images: [] })
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
      const orders = await request.get('/repair/orders', {}, true)
      this.setData({ orders })
    } finally {
      this.setData({ loadingOrders: false })
    }
  },

  async loadTechnicians() {
    try {
      const technicians = await request.get('/repair/technicians', {}, true, { silent: true })
      if (Array.isArray(technicians) && technicians.length) this.setData({ technicians })
    } catch (e) {
      this.setData({ technicians: [], selectedTechnician: null, selectedTechnicianPhone: '' })
      wx.showToast({ title: '维修人员暂时无法加载，请稍后重试', icon: 'none' })
    }
  }
})
