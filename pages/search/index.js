const api = require('../../utils/api')
const { runPullDownRefresh } = require('../../utils/refresh')
const { buildHotPosts, isDailyHotVisible } = require('../../utils/hot-rank')

let searchTimer = null

Page({
  data: {
    keyword: '',
    results: [],
    searched: false,
    loading: false,
    hasMore: false,
    hotPosts: [],
    hotLoading: true,
    // 「显示每日热榜」用户偏好：关闭时隐藏今日热榜区
    dailyHotVisible: true
  },

  onLoad() {
    this.loadTodayHot()
    // 标记首次加载已发过请求，避免紧随其后的 onShow 再重复拉一次
    this._loadedOnce = true
  },

  onShow() {
    // 每次可见时同步「显示每日热榜」用户偏好（设置页修改后返回立即生效）
    const dailyHotVisible = isDailyHotVisible()
    if (dailyHotVisible !== this.data.dailyHotVisible) this.setData({ dailyHotVisible })
    // 本页会留在导航栈里（从搜索结果点进帖子详情再返回时 onShow 触发、onLoad 不重跑）。
    // 不重拉的话，作者/管理员在别处删除的帖子会一直留在「今日热榜」里。
    if (this._loadedOnce) this.loadTodayHot()
  },

  loadTodayHot() {
    this.setData({ hotLoading: true })
    return api.getHotPostRank('today').then((res) => {
      // 与首页/详情页热榜一致：压平换行与连续空白，避免长文撑破单行布局
      // （buildHotPosts 内部已统一过滤「本地标记为已删除」的帖子）
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
    this._searchPage = 1
    this.setData({ loading: true, searched: true, hasMore: false })
    return api.searchPosts(kw).then((res) => {
      this.setData({ results: res.list || [], loading: false, hasMore: !!res.hasMore })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  // 上滑加载下一页搜索结果
  onReachBottom() {
    const kw = this.data.keyword.trim()
    if (!kw || !this.data.hasMore || this._searchLoadingMore) return
    this._searchLoadingMore = true
    api.searchPosts(kw, (this._searchPage || 1) + 1).then((res) => {
      this._searchPage = (this._searchPage || 1) + 1
      this.setData({
        results: this.data.results.concat(res.list || []),
        hasMore: !!res.hasMore
      })
    }).catch(() => {}).then(() => { this._searchLoadingMore = false })
  },

  onClear() {
    this.setData({ keyword: '', results: [], searched: false, hasMore: false })
  },

  onHotPostTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/post-detail/index?id=' + id })
  }
})
