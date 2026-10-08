const { runPullDownRefresh } = require('../../../utils/refresh')

Page({
  data: {},

  onPullDownRefresh() {
    runPullDownRefresh(this)
  }
})
