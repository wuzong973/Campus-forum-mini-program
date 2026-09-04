const api = require('../../utils/api')

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
    api.getHotPostRank('today').then((res) => {
      this.setData({ hotPosts: res.list || [], hotLoading: false })
    }).catch(() => this.setData({ hotPosts: [], hotLoading: false }))
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
    api.searchPosts(kw).then((res) => {
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
