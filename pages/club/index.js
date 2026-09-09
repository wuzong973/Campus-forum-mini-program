const { CLUB_CATEGORIES, fetchCategories } = require('../../utils/club-data')

Page({
  data: {
    pageTitle: '社团&组织',
    categories: [],
    stats: { categoryCount: 0, clubCount: 0, scopeCount: 0 }
  },

  computeStats(categories) {
    return {
      categoryCount: categories.length,
      clubCount: categories.reduce((sum, item) => sum + (item.clubs || []).length, 0),
      scopeCount: categories.reduce((sum, item) => sum + (item.scope || []).length, 0)
    }
  },

  onLoad() {
    // 先用本地数据秒开，再拉服务端数据覆盖（后台编辑后实时生效）
    this.setData({
      categories: CLUB_CATEGORIES,
      stats: this.computeStats(CLUB_CATEGORIES)
    })
    this.loadServerData()
  },

  onPullDownRefresh() {
    this.loadServerData(() => wx.stopPullDownRefresh())
  },

  loadServerData(done) {
    fetchCategories().then((categories) => {
      if (!categories || !categories.length) {
        if (typeof done === 'function') done()
        return
      }
      this.setData({
        categories,
        stats: this.computeStats(categories)
      })
      if (typeof done === 'function') done()
    }).catch(() => {
      if (typeof done === 'function') done()
    })
  },

  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id
    const category = this.data.categories.find((item) => item.id === id)
    if (!category) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/pages/club/detail?id=' + category.id
    })
  }
})
