const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { runPullDownRefresh } = require('../../utils/refresh')

const TYPE_META = {
  liked: { title: '已点赞', empty: '还没有点赞过帖子' },
  shared: { title: '已转发', empty: '还没有转发过帖子' },
  commented: { title: '已评论', empty: '还没有评论过帖子' },
  favorited: { title: '已收藏', empty: '还没有收藏过帖子' }
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

  loadList(append) {
    if (append && (this._listLoading || this._listHasMore === false)) return
    const page = append ? (this._listPage || 1) + 1 : 1
    this._listLoading = true
    this.setData(append ? {} : { loading: true, list: [] })
    api.getMyInteractionList(this.data.type, page).then((res) => {
      this._listPage = page
      this._listHasMore = !!res.hasMore
      this.setData({
        list: append ? this.data.list.concat(res.list || []) : (res.list || []),
        loading: false
      })
    }).catch(() => {
      this.setData({ loading: false })
    }).then(() => { this._listLoading = false })
  },

  onReachBottom() {
    this.loadList(true)
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, this.loadList)
  },

  openProfile(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/profile/index?id=' + id })
  }
})
