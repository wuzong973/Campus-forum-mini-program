const api = require('../../utils/api')
const { runPullDownRefresh } = require('../../utils/refresh')

// 帖子详情预览文案：标题优先，无标题时截取正文
function postDisplayText(item) {
  const title = String(item.title || '').trim()
  if (title) return title
  const content = String(item.content || '').replace(/\s+/g, ' ').trim()
  return content ? (content.length > 60 ? content.slice(0, 60) + '…' : content) : '（无标题）'
}

Page({
  data: {
    activeTab: 'users',
    list: [],
    loading: false,
    loaded: false,
    posts: [],
    postLoading: false,
    postLoaded: false
  },

  onShow() {
    this.loadList()
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadCurrent())
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.loadCurrent()
  },

  loadCurrent() {
    if (this.data.activeTab === 'posts') return this.loadPosts()
    return this.loadList()
  },

  loadList() {
    this.setData({ loading: true })
    api.getBlacklist().then((res) => {
      const list = (res && res.list || []).map((item) => Object.assign({}, item, {
        dateText: this.formatDate(item.createdAt),
        registeredText: this.formatDate(item.registeredAt)
      }))
      this.setData({ list, loading: false, loaded: true })
    }).catch(() => {
      this.setData({ loading: false, loaded: true })
    })
  },

  loadPosts() {
    this.setData({ postLoading: true })
    api.getMyHiddenPosts().then((list) => {
      const posts = (list || []).map((item) => Object.assign({}, item, {
        dateText: this.formatDate(item.hiddenAt),
        displayText: postDisplayText(item)
      }))
      this.setData({ posts, postLoading: false, postLoaded: true })
    }).catch(() => {
      this.setData({ postLoading: false, postLoaded: true })
    })
  },

  // 点击帖子行：拉黑中的帖子提示先恢复；已恢复的可进入帖子详情
  onPreviewPost(e) {
    const item = this.data.posts[Number(e.currentTarget.dataset.index)]
    if (!item) return
    if (!item.restored) {
      wx.showToast({ title: '你已拉黑此帖子，请点击“恢复展示”以查看', icon: 'none', duration: 2500 })
      return
    }
    wx.navigateTo({ url: '/pages/post-detail/index?id=' + item.id })
  },

  // 恢复被拉黑的帖子：解除隐藏后保留在列表中，可点击进入详情
  onRestorePost(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.posts[index]
    if (!item) return
    if (item.restored) {
      wx.navigateTo({ url: '/pages/post-detail/index?id=' + item.id })
      return
    }
    wx.showModal({
      title: '恢复展示',
      content: '恢复后这条帖子将重新出现在信息流中，确定恢复吗？',
      success: (res) => {
        if (!res.confirm) return
        api.unhidePost(item.id).then(() => {
          this.setData({ ['posts[' + index + '].restored']: true })
          wx.showToast({ title: '已恢复', icon: 'success' })
        }).catch((err) => {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        })
      }
    })
  },

  formatDate(value) {
    const text = String(value || '')
    return text.length >= 10 ? text.slice(0, 10) : (text || '—')
  },

  // 点击用户行：拉黑中的用户提示先恢复；已恢复的可进入该用户个人主页
  onPreviewUser(e) {
    const item = this.data.list[Number(e.currentTarget.dataset.index)]
    if (!item) return
    if (!item.restored) {
      wx.showToast({ title: '你已拉黑此用户，请点击“恢复展示”以查看', icon: 'none', duration: 2500 })
      return
    }
    wx.navigateTo({ url: '/pages/profile/index?id=' + item.userId })
  },

  // 恢复被拉黑的用户：解除拉黑后保留在列表中，可点击进入其个人主页
  onUnblock(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.list[index]
    if (!item) return
    if (item.restored) {
      wx.navigateTo({ url: '/pages/profile/index?id=' + item.userId })
      return
    }
    wx.showModal({
      title: '恢复展示',
      content: '恢复后将解除对「' + (item.nick || '该用户') + '」的拉黑，其帖子与私信会重新展示，确定恢复吗？',
      success: (res) => {
        if (!res.confirm) return
        api.unblockUser(item.userId).then(() => {
          this.setData({ ['list[' + index + '].restored']: true })
          wx.showToast({ title: '已恢复', icon: 'success' })
        }).catch((err) => {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        })
      }
    })
  },

  goBack() { wx.navigateBack() }
})
