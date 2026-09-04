const { runPullDownRefresh } = require('../../utils/refresh')

const ALLOWED_HOSTS = new Set([
  'jw.gdipu.edu.cn',
  'mobilelib.wx.chaoxing.com',
  'www.720yun.com',
  'payun01.cn'
])

Page({
  data: { url: '' },
  onLoad(options) {
    const url = decodeURIComponent(options.url || '')
    const hostMatch = url.match(/^https:\/\/([^/:?#]+)/i)
    const hostname = hostMatch ? hostMatch[1].toLowerCase() : ''
    if (/^https:\/\//i.test(url) && ALLOWED_HOSTS.has(hostname)) {
      wx.setNavigationBarTitle({ title: options.title || '加载中...' })
      this.setData({ url })
    } else if (url) {
      wx.showToast({ title: '该服务链接未通过安全校验', icon: 'none' })
    }
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  }
})
