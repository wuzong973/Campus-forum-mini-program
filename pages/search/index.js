const api = require('../../utils/api')

let searchTimer = null

Page({
  data: {
    keyword: '',
    results: [],
    searched: false,
    loading: false
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
    api.getPostList({ page: 1, pageSize: 50, category: '' }).then((res) => {
      const results = (res.list || []).filter((p) =>
        (p.content && p.content.indexOf(kw) > -1) ||
        (p.category && p.category.indexOf(kw) > -1) ||
        (p.nickName && p.nickName.indexOf(kw) > -1)
      )
      this.setData({ results, loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  onClear() {
    this.setData({ keyword: '', results: [], searched: false })
  }
})
