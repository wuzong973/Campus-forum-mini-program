const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    activeTopic: 0,
    activeSubTab: 0,
    activeDeletedTab: 0,
    posts: [],
    squattedPosts: [],
    squattedLoaded: false,
    deletedPosts: [],
    deletedLoaded: false,
    hiddenPosts: [],
    hiddenLoaded: false,
    loading: true
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    })
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
    if (this.data.activeTopic === 1) this.loadDeletedView()
    else if (this.data.activeSubTab === 1) this.loadSquattedPosts()
    else this.loadPosts()
  },

  loadCurrentView() {
    if (this.data.activeTopic === 1) this.loadDeletedView()
    else if (this.data.activeSubTab === 1) this.loadSquattedPosts()
    else this.loadPosts()
  },

  // 「我删除的」下分 隐藏/删除 两个子列表
  loadDeletedView() {
    if (this.data.activeDeletedTab === 0) this.loadHiddenPosts()
    else this.loadDeletedPosts()
  },

  loadPosts() {
    this.setData({ loading: true })
    const userId = Number((getApp().globalData.userInfo || {}).id || 0)
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

  loadDeletedPosts() {
    this.setData({ loading: true })
    const userId = Number((getApp().globalData.userInfo || {}).id || 0)
    const storageKey = 'my_deleted_posts_' + userId
    const localPosts = wx.getStorageSync(storageKey) || []
    api.getMyDeletedPosts().then((deletedPosts) => {
      const merged = (deletedPosts || []).concat(localPosts).filter((post, index, list) => list.findIndex((item) => item.id === post.id) === index)
      this.setData({ deletedPosts: merged, deletedLoaded: true, loading: false })
    }).catch(() => {
      this.setData({ deletedPosts: localPosts, deletedLoaded: true, loading: false })
    })
  },

  loadHiddenPosts() {
    this.setData({ loading: true })
    api.getMyHiddenPosts().then((hiddenPosts) => {
      this.setData({ hiddenPosts: hiddenPosts || [], hiddenLoaded: true, loading: false })
    }).catch(() => {
      this.setData({ hiddenLoaded: true, loading: false })
    })
  },

  onUnhidePost(e) {
    const postId = Number(e.currentTarget.dataset.id)
    if (!postId) return
    api.unhidePost(postId).then(() => {
      this.setData({ hiddenPosts: this.data.hiddenPosts.filter((post) => post.id !== postId) })
      wx.showToast({ title: '已取消隐藏', icon: 'success' })
    }).catch((err) => {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    })
  },

  loadSquattedPosts() {
    this.setData({ loading: true })
    api.getMyInteractionList('favorited').then((res) => {
      this.setData({ squattedPosts: (res && res.list) || [], squattedLoaded: true, loading: false })
    }).catch(() => {
      this.setData({ squattedLoaded: true, loading: false })
    })
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadCurrentView())
  },

  onPostRemove(e) {
    const postId = (e.detail || {}).postId
    const removed = this.data.posts.find((post) => post.id === postId)
    if (!removed) return
    this.setData({
      posts: this.data.posts.filter((post) => post.id !== postId),
      deletedPosts: [{ ...removed, isDeleted: true }].concat(this.data.deletedPosts),
      deletedLoaded: true
    })
    const userId = Number((getApp().globalData.userInfo || {}).id || 0)
    const storageKey = 'my_deleted_posts_' + userId
    const stored = wx.getStorageSync(storageKey) || []
    wx.setStorageSync(storageKey, [{ ...removed, isDeleted: true }].concat(stored.filter((post) => post.id !== postId)))
  },

  onTopicTab(e) {
    const activeTopic = Number(e.currentTarget.dataset.index)
    if (activeTopic === this.data.activeTopic) return
    this.setData({ activeTopic })
    if (activeTopic === 1) {
      if (this.data.activeDeletedTab === 0 && !this.data.hiddenLoaded) this.loadHiddenPosts()
      else if (this.data.activeDeletedTab === 1 && !this.data.deletedLoaded) this.loadDeletedPosts()
    }
  },

  onDeletedTab(e) {
    const activeDeletedTab = Number(e.currentTarget.dataset.index)
    if (activeDeletedTab === this.data.activeDeletedTab) return
    this.setData({ activeDeletedTab })
    if (activeDeletedTab === 0 && !this.data.hiddenLoaded) this.loadHiddenPosts()
    else if (activeDeletedTab === 1 && !this.data.deletedLoaded) this.loadDeletedPosts()
  },

  onSubTab(e) {
    const activeSubTab = Number(e.currentTarget.dataset.index)
    if (activeSubTab === this.data.activeSubTab) return
    this.setData({ activeSubTab })
    if (activeSubTab === 1 && !this.data.squattedLoaded) this.loadSquattedPosts()
  },

  onSquattedRemove(e) {
    const postId = (e.detail || {}).postId
    this.setData({ squattedPosts: this.data.squattedPosts.filter((post) => post.id !== postId) })
  },

  goBack() { wx.navigateBack() },

  goPublish() {
    if (!auth.requirePublishReady()) return
    wx.navigateTo({ url: '/pages/post-publish/index' })
  }
})
