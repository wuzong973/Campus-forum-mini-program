const api = require('../../utils/api')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: { sections: [], loading: true, loadError: false },

  onLoad() {
    this.loadServices()
  },

  loadServices() {
    this.setData({ loading: true, loadError: false })
    return api.getServiceList().then((data) => {
      this.setData({ sections: Array.isArray(data) ? data : [], loading: false })
    }).catch(() => {
      this.setData({ sections: [], loading: false, loadError: true })
    })
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadServices())
  },

  onServiceTap(e) {
    const item = e.detail.item
    // 教务考试安排：进入考试安排页
    if (item.name === '考试安排') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pkg-schedule/schedule-exam/index' })
      return
    }
    // 教务成绩查询：进入成绩查询页
    if (item.name === '成绩查询') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pkg-schedule/schedule-grade/index' })
      return
    }
    // 失物招领：切回首页并定位到"失物寻物"分类
    if (item.name === '失物招领') {
      wx.vibrateShort({ type: 'light' })
      wx.setStorageSync('home_pending_category', '失物寻物')
      wx.switchTab({ url: '/pages/index/index' })
      return
    }
    // 二手闲置：切回首页并定位到"二手闲置"分类
    if (item.name === '二手闲置') {
      wx.vibrateShort({ type: 'light' })
      wx.setStorageSync('home_pending_category', '二手闲置')
      wx.switchTab({ url: '/pages/index/index' })
      return
    }
    // 教务系统：跳转教务系统首页（webview 内嵌）
    if (item.name === '教务系统') {
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent('https://jw.gdipu.edu.cn/jsxsd') + '&title=' + encodeURIComponent('教务系统')
      })
      return
    }
    // 跳转到外部小程序（乘车码 / 零食店 等）
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
    // 跳转到外部 H5 页面（订水系统 / 自助购电 等）
    if (item.link) {
      if (!/^https?:\/\//i.test(item.link)) {
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
      '广轻义修': '/pages/repair/index',
      '校园地图': '/pages/campus-map/index',
      '社团&组织': '/pages/club/index',
      '广轻群聊': '/pages/group-chat/index'
    }
    const url = routes[item.name]
    if (url) {
      if (url === '/pages/repair/index' || url === '/pages/campus-map/index' || url === '/pages/club/index' || url === '/pages/group-chat/index') wx.navigateTo({ url })
      else wx.switchTab({ url })
    } else {
      wx.showToast({ title: item.name + ' 即将上线', icon: 'none' })
    }
  }
})
