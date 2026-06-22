const format = require('../../utils/format')

const STATUS_TEXT = {
  pending: '待接单',
  accepted: '进行中',
  done: '已完成'
}

Component({
  properties: {
    order: { type: Object, value: {} }
  },
  data: { timeText: '', statusText: '待接单' },
  observers: {
    'order': function (order) {
      if (!order) return
      const statusClass = order.statusClass || order.status
      this.setData({
        statusText: STATUS_TEXT[statusClass] || '待接单',
        timeText: order.createdAt ? format.formatRelativeTime(order.createdAt) : ''
      })
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
    }
  },
  methods: {
    onAccept() {
      this.triggerEvent('accept', { order: this.data.order })
    },
    onFinish() {
      this.triggerEvent('finish', { order: this.data.order })
    },
    onContact() {
      this.triggerEvent('contact', { order: this.data.order })
    }
  }
})
