const auth = require('../../utils/auth')
const request = require('../../utils/request')
const format = require('../../utils/format')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    id: '',
    order: null,
    loading: true,
    canViewRemark: false,
    accepting: false,
    showReview: false,
    reviewRating: 5,
    reviewContent: '',
    reviewing: false
  },

  onLoad(options) {
    if (!auth.requireLogin('查看订单详情需要先登录')) {
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    this.setData({ id: options.id || '' })
    this.loadOrder()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadOrder())
  },

  goBack() { wx.navigateBack() },
  openComplete() { if (this.data.order && this.data.order.id) wx.navigateTo({ url: '/pages/errand-complete/index?id=' + this.data.order.id }) },
  openCancel() { if (this.data.order && this.data.order.id) wx.navigateTo({ url: '/pages/errand-cancel/index?id=' + this.data.order.id }) },

  loadOrder() {
    if (!this.data.id) return
    this.setData({ loading: true })
    if (request.USE_MOCK) {
      const mock = require('../../utils/mock')
      const published = mock.myPublishedOrders.find((item) => String(item.id) === String(this.data.id))
      const accepted = mock.myAcceptedOrders.find((item) => String(item.id) === String(this.data.id))
      const order = published || accepted || mock.errandOrders.find((item) => String(item.id) === String(this.data.id))
      this.setData({
        order: this.normalizeOrder(order),
        canViewRemark: !!(published || accepted),
        loading: false
      })
      return
    }
    request.get('/errand/' + this.data.id, {}, true).then((data) => {
      this.setData({
        order: this.normalizeOrder(data.order),
        canViewRemark: !!data.canViewRemark,
        loading: false
      })
    }).catch(() => this.setData({ loading: false }))
  },

  normalizeOrder(order) {
    if (!order) return null
    const appointmentTime = order.appointmentTime || order.appointment_time || ''
    return Object.assign({}, order, {
      reward: order.reward || order.totalAmount || '',
      pickupAddr: order.pickupAddr || order.pickup_addr || '',
      deliveryAddr: order.deliveryAddr || order.delivery_addr || '',
      receiverName: order.receiverName || order.receiver_name || '',
      receiverPhone: order.receiverPhone || order.receiver_phone || '',
      deliveryBuilding: order.deliveryBuilding || order.delivery_building || '',
      deliveryRoom: order.deliveryRoom || order.delivery_room || '',
      description: order.description || order.desc || '',
      genderRequirement: order.genderRequirement || order.gender_requirement || '',
      pickupTimeType: order.pickupTimeType || order.pickup_time_type || '尽快',
      appointmentText: appointmentTime ? format.formatDateTime(appointmentTime) : '',
      createdText: format.formatDateTime(order.createdAt || order.created_at),
      isOwner: order.role === 'publisher'
    })
  },

  onAccept() {
    const order = this.data.order
    if (!order || order.status !== 'pending' || this.data.accepting) return
    wx.showModal({
      title: '确认接单',
      content: '接单后可查看发单者备注信息。',
      success: (result) => {
        if (!result.confirm) return
        this.setData({ accepting: true })
        if (request.USE_MOCK) {
          order.status = 'accepted'
          order.role = 'accepter'
          this.setData({ order, canViewRemark: true, accepting: false })
          wx.showToast({ title: '接单成功', icon: 'success' })
          return
        }
        request.post('/errand/' + order.id + '/accept', {}, true).then(() => {
          wx.showToast({ title: '接单成功', icon: 'success' })
          this.loadOrder()
        }).finally(() => this.setData({ accepting: false }))
      }
    })
  },

  noop() {},

  openReview() {
    this.setData({ showReview: true })
  },

  closeReview() {
    if (!this.data.reviewing) this.setData({ showReview: false })
  },

  chooseRating(e) {
    this.setData({ reviewRating: Number(e.currentTarget.dataset.rating) })
  },

  onReviewInput(e) {
    this.setData({ reviewContent: e.detail.value })
  },

  submitReview() {
    const order = this.data.order
    if (!order || this.data.reviewing) return
    if (request.USE_MOCK) {
      wx.showToast({ title: '演示模式暂不支持评价', icon: 'none' })
      return
    }
    this.setData({ reviewing: true })
    request.post('/errand/' + order.id + '/review', {
      rating: this.data.reviewRating,
      content: this.data.reviewContent.trim()
    }, true).then(() => {
      wx.showToast({ title: '评价成功', icon: 'success' })
      this.setData({ showReview: false, reviewContent: '' })
    }).finally(() => this.setData({ reviewing: false }))
  }
})
