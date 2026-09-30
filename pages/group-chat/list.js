const api = require('../../utils/api')
const { charAvatar, categoryTheme } = require('../../utils/group-chat')
const { getDefaultCampus, MAIN_CAMPUS_OPTIONS } = require('../../utils/campus')

Page({
  data: {
    statusBarHeight: 20,
    categoryName: '',
    campus: '',
    showCampusPanel: false,
    groups: [],
    loaded: false,
    loadError: false
  },

  onLoad(options) {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    const categoryName = decodeURIComponent((options && options.name) || '')
    // 默认选中用户在「设置」中选择的校区（也支持上级页面带入）
    const fromQuery = decodeURIComponent((options && options.campus) || '')
    const fromQueryValid = MAIN_CAMPUS_OPTIONS.indexOf(fromQuery) >= 0
    const campus = fromQueryValid ? fromQuery : getDefaultCampus()
    // 上级页面显式带入校区时视为已选定，onShow 不再用默认值覆盖
    this._campusTouched = fromQueryValid
    this.setData({ statusBarHeight: info.statusBarHeight || 20, categoryName, campus })
    this.loadGroups()
  },

  onPullDownRefresh() {
    this.loadGroups(() => wx.stopPullDownRefresh())
  },

  onShow() {
    // 从设置页返回时同步所选校区并刷新列表；用户手动切过校区时尊重其选择
    if (this._campusTouched) return
    const def = getDefaultCampus()
    if (def !== this.data.campus) {
      this.setData({ campus: def })
      this.loadGroups()
    }
  },

  // 拉取当前校区已上架群聊并过滤出当前分类
  loadGroups(done) {
    api.getGroupChatList(this.data.campus).then((res) => {
      const theme = categoryTheme(this.data.categoryName)
      const raw = (res && res.list) || []
      const list = raw
        .filter((item) => (item.category || '其他') === this.data.categoryName)
        .map((item) => Object.assign({}, item, {
          firstChar: (item.name || '').charAt(0),
          fallbackBg: theme.gradient
        }))
      this.setData({ groups: list, loaded: true, loadError: false })
      if (typeof done === 'function') done()
    }).catch(() => {
      // 请求失败必须可见（不再静默显示"暂无群聊"），提供重试入口
      this.setData({ loaded: true, loadError: true })
      if (typeof done === 'function') done()
    })
  },

  // 加载失败 → 点击重试
  retryLoad() {
    this.setData({ loaded: false, loadError: false })
    this.loadGroups()
  },

  // ===== 校区选择器 =====
  onToggleCampus() {
    this.setData({ showCampusPanel: !this.data.showCampusPanel })
  },

  onCloseCampus() {
    this.setData({ showCampusPanel: false })
  },

  // 校区选择器组件回调（仅主校区层级）
  onCampusChange(e) {
    const campus = e.detail.value
    this._campusTouched = true
    if (campus === this.data.campus) {
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
