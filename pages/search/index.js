const api = require('../../utils/api')
const { runPullDownRefresh } = require('../../utils/refresh')
const { buildHotPosts } = require('../../utils/hot-rank')

let searchTimer = null

Page({
  data: {
    keyword: '',
    results: [],
    searched: false,
    loading: false,
    hotPosts: [],
    hotLoading: true
  },

  onLoad() {
    this.loadTodayHot()
  },

  loadTodayHot() {
    this.setData({ hotLoading: true })
    return api.getHotPostRank('today').then((res) => {
      // 与首页/详情页热榜一致：压平换行与连续空白，避免长文撑破单行布局
      this.setData({ hotPosts: buildHotPosts(res.list || []), hotLoading: false })
    }).catch(() => this.setData({ hotPosts: [], hotLoading: false }))
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, [
      () => this.loadTodayHot(),
      () => { if (this.data.searched) this.onSearch() }
    ])
  },

  onInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      if (keyword.trim()) this.onSearch()
    }, 400)
  },

  onSearch() {
    const kw = this.data.keyword.trim()
    if (!kw) return
    this.setData({ loading: true, searched: true })
    return api.searchPosts(kw).then((res) => {
      this.setData({ results: res.list || [], loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  onClear() {
    this.setData({ keyword: '', results: [], searched: false })
  },

  onHotPostTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/post-detail/index?id=' + id })
  }
})
