const { CLUB_CATEGORIES, fetchCategories } = require('../../utils/club-data')
const { getDefaultCampus } = require('../../utils/campus')

Page({
  data: {
    pageTitle: '社团&组织',
    campus: '',
    showCampusPanel: false,
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
    // 默认选中用户在「设置」中选择的校区
    this.setData({ campus: getDefaultCampus() })
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
    fetchCategories(this.data.campus).then((categories) => {
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

  // ===== 校区选择器 =====
  onToggleCampus() {
    this.setData({ showCampusPanel: !this.data.showCampusPanel })
  },

  onCloseCampus() {
    this.setData({ showCampusPanel: false })
  },

  // 校区选择器组件回调（含主校区/分校区两级）
  onCampusChange(e) {
    const campus = e.detail.value
    if (campus === this.data.campus) {
      this.setData({ showCampusPanel: false })
      return
    }
    wx.vibrateShort({ type: 'light' })
    this.setData({ campus, showCampusPanel: false })
    this.loadServerData()
  },

  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id
    const category = this.data.categories.find((item) => item.id === id)
    if (!category) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/pages/club/detail?id=' + category.id + '&campus=' + encodeURIComponent(this.data.campus)
    })
  },

  noop() {}
})
