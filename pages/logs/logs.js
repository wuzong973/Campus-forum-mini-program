// logs.js
const format = require('../../utils/format.js')

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
  }
})
