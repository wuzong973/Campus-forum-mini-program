const auth = require('../../utils/auth')
const request = require('../../utils/request')

Page({
  data: {
    types: ['快递', '外卖', '代办'],
    typeEmojis: ['📦', '🍔', '📝'],
    typeIndex: 0,
    title: '',
    desc: '',
    reward: '',
    pickupAddr: '',
    deliveryAddr: '',
    campuses: ['佛山校区', '广州校区'],
    campusIndex: 0,
    itemCount: 1,
    timeLimits: ['不限时间', '1小时内', '2小时内', '今天内', '明天内'],
    timeLimitIndex: 0,
    genderReqs: ['不限性别', '仅限男生', '仅限女生'],
    genderReq: '不限性别',
    noUpstairs: false,
    submitting: false
  },

  onLoad() {
    if (!auth.requireLogin('发布跑腿需要先登录')) {
      setTimeout(() => wx.navigateBack(), 500)
    }
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  onTypePick(e) {
    this.setData({ typeIndex: Number(e.currentTarget.dataset.index) })
  },

  onCampus(e) {
    this.setData({ campusIndex: parseInt(e.detail.value, 10) })
  },

  onTimeLimit(e) {
    this.setData({ timeLimitIndex: parseInt(e.detail.value, 10) })
  },

  onGenderPick(e) {
    this.setData({ genderReq: e.currentTarget.dataset.val })
  },

  onStep(e) {
    const action = e.currentTarget.dataset.action
    let count = this.data.itemCount
    if (action === 'plus') count++
    else if (action === 'minus' && count > 1) count--
    this.setData({ itemCount: count })
  },

  onToggleUpstairs() {
    this.setData({ noUpstairs: !this.data.noUpstairs })
  },

  onSubmit() {
    const { title, reward, pickupAddr, deliveryAddr } = this.data
    if (!title.trim()) {
      wx.showToast({ title: '请填写需求标题', icon: 'none' })
      return
    }
    if (!reward) {
      wx.showToast({ title: '请填写报酬金额', icon: 'none' })
      return
    }
    if (!pickupAddr.trim() || !deliveryAddr.trim()) {
      wx.showToast({ title: '请填写取件与送达地址', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    const payload = {
      type: this.data.types[this.data.typeIndex],
      title: this.data.title.trim(),
      desc: this.data.desc.trim(),
      reward: parseFloat(this.data.reward),
      pickupAddr: this.data.pickupAddr.trim(),
      deliveryAddr: this.data.deliveryAddr.trim(),
      campus: this.data.campuses[this.data.campusIndex],
      itemCount: this.data.itemCount,
      timeLimit: this.data.timeLimits[this.data.timeLimitIndex],
      genderReq: this.data.genderReq,
      noUpstairs: this.data.noUpstairs
    }
    if (request.USE_MOCK) {
      const mock = require('../../utils/mock')
      mock.errandOrders.unshift(Object.assign(
        { id: Date.now(), status: 'pending', publisherName: '我', role: 'publisher', createdAt: new Date().toISOString() },
        payload
      ))
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
      this.setData({ submitting: false })
      return
    }
    request.post('/errand', payload, true).then(() => {
      wx.showToast({ title: '发布成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1200)
    }).finally(() => {
      this.setData({ submitting: false })
    })
  }
})
