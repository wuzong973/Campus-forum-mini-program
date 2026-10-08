const { runPullDownRefresh } = require('../../../utils/refresh')

Page({
  data: {
    // errand = 跑腿发单系统协议（图八）；默认 user = 校园小程序用户协议
    mode: 'user'
  },

  onLoad(options) {
    if (options && options.type === 'errand') {
      this.setData({ mode: 'errand' })
      wx.setNavigationBarTitle({ title: '发单系统协议' })
    }
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  }
})
