const { runPullDownRefresh } = require('../../utils/refresh')

const ALLOWED_HOSTS = new Set([
  // 教务系统 jw.gdipu.edu.cn 已改为服务端抓取 + 原生渲染（pkg-schedule/schedule-home），
  // 不再通过 web-view 打开，故从白名单移除
  'mobilelib.wx.chaoxing.com',
  'www.720yun.com',
  'payun01.cn'
])

Page({
  data: { url: '', blockedUrl: '' },
  onLoad(options) {
    const url = decodeURIComponent(options.url || '')
    const hostMatch = url.match(/^https:\/\/([^/:?#]+)/i)
    const hostname = hostMatch ? hostMatch[1].toLowerCase() : ''
    if (/^https:\/\//i.test(url) && ALLOWED_HOSTS.has(hostname)) {
      // 标题参数经过 encodeURIComponent，需解码后再设置；未传时显式置空，
      // 避免 web-view 自动同步网页 <title> 到导航栏
      let title = options.title || ''
      try { title = decodeURIComponent(title) } catch (e) { /* 保留原值 */ }
      wx.setNavigationBarTitle({ title })
      this.setData({ url })
    } else if (url) {
      // 非可信域名：web-view 平台层也要求域名配置为小程序业务域名才能打开，
      // 展示兜底页并提供复制，引导用户到浏览器打开
      this.setData({ blockedUrl: url })
      wx.setClipboardData({
        data: url,
        success: () => wx.showToast({ title: '链接已复制，可到浏览器打开', icon: 'none' })
      })
    }
  },

  onCopyBlockedUrl() {
    if (!this.data.blockedUrl) return
    wx.setClipboardData({
      data: this.data.blockedUrl,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    })
  },

  onPullDownRefresh() {
    runPullDownRefresh(this)
  }
})
