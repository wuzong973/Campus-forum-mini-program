const api = require('../../utils/api')
const auth = require('../../utils/auth')
const request = require('../../utils/request')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    postId: 0,
    originalPost: null,
    shareContent: '',
    sharing: false
  },

  onLoad(options) {
    const postId = parseInt(options.postId, 10)
    if (!postId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight,
      navBarHeight: getApp().globalData.navBarHeight,
      postId
    })
    this.loadOriginalPost(postId)
  },

  loadOriginalPost(postId) {
    return api.getPostDetail(postId).then((post) => {
      if (post) {
        this.setData({ originalPost: post })
      } else {
        wx.showToast({ title: '帖子不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
      }
    })
  },

  onShareContentInput(e) {
    this.setData({ shareContent: e.detail.value })
  },

  onShare() {
    if (!auth.requireLogin('转发需要先登录')) return
    if (this.data.sharing) return

    this.setData({ sharing: true })

    if (request.USE_MOCK) {
      // Mock 模式
      setTimeout(() => {
        this.setData({ sharing: false })
        wx.showToast({ title: '转发成功', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1500)
      }, 500)
      return
    }

    api.createShare(this.data.postId, this.data.shareContent).then(() => {
      this.setData({ sharing: false })
      wx.showToast({ title: '转发成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1500)
    }).catch((err) => {
      this.setData({ sharing: false })
      wx.showToast({ title: err.message || '转发失败', icon: 'none' })
    })
  },

  onBack() {
    wx.navigateBack()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadOriginalPost(this.data.postId))
  }
})
