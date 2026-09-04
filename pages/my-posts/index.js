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
    const userId = (getApp().globalData.userInfo || {}).id
    if (!userId) {
      this.setData({ posts: [], loading: false })
      return
    }
    api.getUserPosts(userId).then((posts) => {
      this.setData({ posts: posts || [], loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  onPostRemove(e) {
    const postId = (e.detail || {}).postId
    this.setData({ posts: this.data.posts.filter((post) => post.id !== postId) })
  },

  goPublish() {
    if (!auth.requirePublishReady()) return
    wx.navigateTo({ url: '/pages/post-publish/index' })
  }
})
