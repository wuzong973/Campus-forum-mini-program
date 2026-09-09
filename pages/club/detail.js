const { getCategoryById, fetchCategories } = require('../../utils/club-data')
const { CAMPUS_OPTIONS, getDefaultCampus } = require('../../utils/campus')

Page({
  data: {
    category: null,
    expandedIndex: -1
  },

  onLoad(options) {
    this.categoryId = (options && options.id) || ''
    // 校区：优先取上级页面带入，缺省回退用户设置中的校区
    const fromQuery = decodeURIComponent((options && options.campus) || '')
    this.campus = CAMPUS_OPTIONS.indexOf(fromQuery) >= 0 ? fromQuery : getDefaultCampus()
    // 先用本地数据秒开，再拉服务端数据覆盖（后台编辑后实时生效）
    this.applyCategory(getCategoryById(this.categoryId))
    fetchCategories(this.campus).then((categories) => {
      const matched = (categories || []).find((item) => item.id === this.categoryId)
      if (matched) {
        this.applyCategory(matched)
        return
      }
      if (!this.data.category) this.failBack()
    }).catch(() => {
      if (!this.data.category) this.failBack()
    })
  },

  failBack() {
    wx.showToast({ title: '分类不存在或已下线', icon: 'none' })
    setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 900)
  },

  applyCategory(category) {
    if (!category) return
    // 为每个社团预计算首字符（用于徽标展示），避免模板内做字符串下标取值
    const clubs = (category.clubs || []).map((club) => Object.assign({}, club, {
      firstChar: (club.name || '').charAt(0)
    }))
    this.setData({
      category: Object.assign({}, category, { clubs }),
      loading: false,
      expandedIndex: -1
    })
    wx.setNavigationBarTitle({ title: category.name })
  },

  // 展开/收起单个社团详情
  onToggleClub(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.vibrateShort({ type: 'light' })
    this.setData({ expandedIndex: this.data.expandedIndex === index ? -1 : index })
  },

  onCopyContact() {
    const category = this.data.category
    if (!category) return
    wx.setClipboardData({
      data: category.contact,
      success() {
        wx.showToast({ title: '联系方式已复制', icon: 'none' })
      }
    })
  }
})
