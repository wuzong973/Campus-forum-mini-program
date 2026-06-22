const api = require('../../utils/api')
const auth = require('../../utils/auth')

Page({
  data: {
    posts: [],
    loading: true
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.showModal({
        title: '提示',
        content: '请先登录',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/login/index' })
          else wx.navigateBack()
        }
      })
      return
    }
    this.loadPosts()
  },

  loadPosts() {
    this.setData({ loading: true })
    const nickName = (getApp().globalData.userInfo || {}).nickName
    api.getPostList({ page: 1, pageSize: 50 }).then((res) => {
      const posts = (res.list || []).filter((p) => p.nickName === nickName || p.nickName === '我')
      this.setData({ posts, loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  goPublish() {
    wx.navigateTo({ url: '/pages/post-publish/index' })
  }
})
