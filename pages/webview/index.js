Page({
  data: { url: '' },
  onLoad(options) {
    const url = decodeURIComponent(options.url || '')
    if (url) {
      wx.setNavigationBarTitle({ title: options.title || '加载中...' })
      this.setData({ url })
    }
  }
})
