const format = require('../../utils/format')

const STATUS_TEXT = {
  unpaid: '待支付',
  pending: '待接单',
  accepted: '进行中',
  done: '已完成',
  cancelled: '已取消',
  refunding: '退款处理中'
}

Component({
  properties: {
    order: { type: Object, value: {} }
  },
  data: { timeText: '', statusText: '待接单', showCancel: false },
  observers: {
    'order': function (order) {
      if (!order) return
      const statusClass = order.statusClass || order.status
      this.setData({
        statusText: STATUS_TEXT[statusClass] || '待接单',
        timeText: order.createdAt ? format.formatRelativeTime(order.createdAt) : ''
      })
      this._calcCancelVisibility(order)
    }
  },
  lifetimes: {
    attached() {
      const order = this.data.order
      if (!order) return
      const statusClass = order.statusClass || order.status
      this.setData({
        statusText: STATUS_TEXT[statusClass] || '待接单',
        timeText: order.createdAt ? format.formatRelativeTime(order.createdAt) : ''
      })
      this._calcCancelVisibility(order)
    }
  },
  methods: {
    onOpen() {
      this.triggerEvent('open', { order: this.data.order })
    },
    // 计算是否显示取消按钮
    _calcCancelVisibility(order) {
      if (!order || order.status === 'done' || order.status === 'finished' || order.status === 'cancelled') {
        this.setData({ showCancel: false })
        return
      }
      let showCancel = false
      if (order.role === 'publisher') {
        // 发布者：订单未完成时随时可取消
        showCancel = true
      } else if (order.role === 'accepter') {
        // 接单者：接单5分钟内可取消
        const acceptedAt = order.acceptedAt || order.createdAt
        if (acceptedAt) {
          const elapsed = Date.now() - new Date(acceptedAt).getTime()
          showCancel = elapsed < 5 * 60 * 1000
        }
      }
      this.setData({ showCancel })
    },

    onAccept() {
      this.triggerEvent('accept', { order: this.data.order })
    },
    onPay() {
      this.triggerEvent('pay', { order: this.data.order })
    },
    onFinish() {
      this.triggerEvent('finish', { order: this.data.order })
    },
    onCancel() {
      this.triggerEvent('cancel', { order: this.data.order })
    },
    onContact() {
      this.triggerEvent('contact', { order: this.data.order })
    }
  }
})
