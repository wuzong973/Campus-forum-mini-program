const api = require('../../utils/api')
const { categoryTheme } = require('../../utils/group-chat')
const { CAMPUS_OPTIONS, getDefaultCampus } = require('../../utils/campus')

Page({
  data: {
    statusBarHeight: 20,
    categoryName: '',
    campus: '',
    campusOptions: CAMPUS_OPTIONS,
    showCampusPanel: false,
    groups: [],
    loaded: false
  },

  onLoad(options) {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    const categoryName = decodeURIComponent((options && options.name) || '')
    // 默认选中用户在「设置」中选择的校区（也支持上级页面带入）
    const fromQuery = decodeURIComponent((options && options.campus) || '')
    const campus = CAMPUS_OPTIONS.indexOf(fromQuery) >= 0 ? fromQuery : getDefaultCampus()
    this.setData({ statusBarHeight: info.statusBarHeight || 20, categoryName, campus })
    this.loadGroups()
  },

  onPullDownRefresh() {
    this.loadGroups(() => wx.stopPullDownRefresh())
  },

  // 拉取当前校区已上架群聊并过滤出当前分类
  loadGroups(done) {
    api.getGroupChatList(this.data.campus).then((res) => {
      const theme = categoryTheme(this.data.categoryName)
      const list = ((res && res.list) || [])
        .filter((item) => (item.category || '其他') === this.data.categoryName)
        .map((item) => Object.assign({}, item, {
          firstChar: (item.name || '').charAt(0),
          fallbackBg: theme.gradient
        }))
      this.setData({ groups: list, loaded: true })
      if (typeof done === 'function') done()
    }).catch(() => {
      this.setData({ loaded: true })
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

  onSelectCampus(e) {
    const campus = e.currentTarget.dataset.value
    if (!campus || campus === this.data.campus) {
      this.setData({ showCampusPanel: false })
      return
    }
    wx.vibrateShort({ type: 'light' })
    this.setData({ campus, showCampusPanel: false })
    this.loadGroups()
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/group-chat/index' })
    })
  },

  // 点击某个群 → 群聊详情（二维码/群管理/群介绍）
  onGroupTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/group-chat/detail?id=' + id })
  },

  noop() {}
})
