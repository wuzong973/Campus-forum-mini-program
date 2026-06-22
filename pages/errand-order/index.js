const mock = require('../../utils/mock')
const auth = require('../../utils/auth')
const request = require('../../utils/request')

Page({
  data: {
    tabs: ['我发布的', '我接的'],
    activeTab: 0,
    statusFilters: ['全部', '待接单', '进行中', '已完成'],
    activeStatus: 0,
    orders: [],
    counts: [0, 0],
    emptyText: '暂无发布订单'
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    // published: 我发布的；accepted: 我接的
    const published = mock.myPublishedOrders.slice()
    const accepted = mock.myAcceptedOrders.slice()
    // 计数：仅统计未完成（待接单 + 进行中）
    const pubCount = published.filter((o) => o.status !== 'done').length
    const accCount = accepted.filter((o) => o.status !== 'done').length
    this.setData({ counts: [pubCount, accCount] })
    this.applyFilter()
  },

  applyFilter() {
    const isPublished = this.data.activeTab === 0
    let list = isPublished ? mock.myPublishedOrders.slice() : mock.myAcceptedOrders.slice()
    const statusMap = ['', 'pending', 'accepted', 'done']
    const target = statusMap[this.data.activeStatus]
    if (target) list = list.filter((o) => o.status === target)
    this.setData({
      orders: list,
      emptyText: isPublished ? '还没有发布的订单' : '还没有接过的订单'
    })
  },

  onTab(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index === this.data.activeTab) return
    this.setData({ activeTab: index, activeStatus: 0 })
    this.applyFilter()
  },

  onStatusFilter(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ activeStatus: index })
    this.applyFilter()
  },

  onAccept(e) {
    const order = e.detail.order
    if (!auth.requireLogin('操作需要先登录')) return
    wx.showModal({
      title: '确认接单',
      content: '确定接受此订单？',
      success: (res) => {
        if (!res.confirm) return
        if (request.USE_MOCK) {
          order.status = 'accepted'
          order.role = 'accepter'
          this.refresh()
          wx.showToast({ title: '接单成功', icon: 'success' })
        }
      }
    })
  },

  onFinish(e) {
    const order = e.detail.order
    wx.showModal({
      title: '确认完成',
      content: '确定此订单已完成配送？',
      success: (res) => {
        if (!res.confirm) return
        if (request.USE_MOCK) {
          order.status = 'done'
          this.refresh()
          wx.showToast({ title: '订单已完成', icon: 'success' })
        }
      }
    })
  },

  onContact() {
    wx.showModal({
      title: '联系对方',
      content: '即将打开微信复制对方微信号，确认操作？',
      confirmText: '复制',
      success: (res) => {
        if (!res.confirm) return
        wx.setClipboardData({ data: 'wechat_id_placeholder' })
      }
    })
  },

  goPublish() {
    if (!auth.requireLogin('发布跑腿需要先登录')) return
    wx.navigateTo({ url: '/pages/errand-publish/index' })
  }
})
