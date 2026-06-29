const api = require('../../utils/api')
const auth = require('../../utils/auth')

const TYPE_META = {
  liked: { title: '已点赞', empty: '还没有点赞过帖子' },
  shared: { title: '已转发', empty: '还没有转发过帖子' },
  commented: { title: '已评论', empty: '还没有评论过帖子' },
  favorited: { title: '已收藏', empty: '还没有收藏过帖子' },
  followed: { title: '已关注', empty: '还没有关注用户' }
}

Page({
  data: {
    type: 'liked',
    title: '已点赞',
    emptyText: '暂无记录',
    list: [],
    loading: true
  },

  onLoad(options) {
    const type = options.type || 'liked'
    const meta = TYPE_META[type] || TYPE_META.liked
    wx.setNavigationBarTitle({ title: meta.title })
    this.setData({
      type,
      title: meta.title,
      emptyText: meta.empty
    })
  },

  onShow() {
    if (!auth.requireLogin('请先登录后查看互动记录')) return
    this.loadList()
  },

  loadList() {
    this.setData({ loading: true })
    api.getMyInteractionList(this.data.type).then((res) => {
      this.setData({
        list: res.list || [],
        loading: false
      })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  openProfile(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/profile/index?id=' + id })
  }
})
