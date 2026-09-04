const api = require('../../utils/api')

Page({
  data: { sections: [], loading: true, loadError: false },

  onLoad() {
    this.loadServices()
  },

  loadServices() {
    this.setData({ loading: true, loadError: false })
    api.getServiceList().then((data) => {
      this.setData({ sections: Array.isArray(data) ? data : [], loading: false })
    }).catch(() => {
      this.setData({ sections: [], loading: false, loadError: true })
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
      if (!/^https:\/\//i.test(item.link)) {
        wx.showToast({ title: '该服务链接暂不可用', icon: 'none' })
        return
      }
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent(item.link) + '&title=' + encodeURIComponent(item.name)
      })
      return
    }
    const routes = {
      '代拿跑腿': '/pages/errand/index',
      '课程表': '/pages/schedule/index',
      '社区论坛': '/pages/index/index',
      '广轻维修': '/pages/repair/index',
      '校园地图': '/pages/campus-map/index'
    }
    const url = routes[item.name]
    if (url) {
      if (url === '/pages/repair/index' || url === '/pages/campus-map/index') wx.navigateTo({ url })
      else wx.switchTab({ url })
    } else {
      wx.showToast({ title: item.name + ' 即将上线', icon: 'none' })
    }
  }
})
