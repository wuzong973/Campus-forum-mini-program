// logs.js
const format = require('../../utils/format.js')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    logs: []
  },
  onLoad() {
    this.setData({
      logs: (wx.getStorageSync('logs') || []).map(log => {
        return {
          date: format.formatTime(new Date(log)),
          timeStamp: log
        }
      })
    })
  },
  onPullDownRefresh() {
    runPullDownRefresh(this)
  }
})
