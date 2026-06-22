const api = require('../../utils/api')

Page({
  data: { sections: [], loading: true },

  onLoad() {
    api.getServiceList().then((data) => {
      const sections = Array.isArray(data) && data[0] && data[0].title
        ? data
        : require('../../utils/mock').allServiceSections
      this.setData({ sections, loading: false })
    }).catch(() => {
      this.setData({
        sections: require('../../utils/mock').allServiceSections,
        loading: false
      })
    })
  },

  onServiceTap(e) {
    const item = e.detail.item
    // 跳转到外部小程序（乘车码 / 食堂菜单 等）
    if (item.miniAppId) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateToMiniProgram({
        appId: item.miniAppId,
        envVersion: 'release',
        success() { console.log('[' + item.name + '] 跳转成功') },
        fail(err) {
          console.error('[' + item.name + '] 跳转失败', err)
          wx.showModal({
            title: '跳转失败',
            content: '错误信息：' + (err && err.errMsg ? err.errMsg : JSON.stringify(err)),
            showCancel: false
          })
        }
      })
      return
    }
    // 跳转到外部 H5 页面（订水系统 / 教务系统 等）
    if (item.link) {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(item.link) + '&title=' + encodeURIComponent(item.name)
      })
      return
    }
    const routes = {
      '代拿跑腿': '/pages/errand/index',
      '课程表': '/pages/schedule/index',
      '社区论坛': '/pages/index/index'
    }
    const url = routes[item.name]
    if (url) {
      wx.switchTab({ url })
    } else {
      wx.showToast({ title: item.name + ' 即将上线', icon: 'none' })
    }
  }
})
