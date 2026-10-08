const { getCategoryById, fetchCategories } = require('../../utils/club-data')
const { isValidCampus, getDefaultCampus } = require('../../../utils/campus')

Page({
  data: {
    statusBarHeight: 20,
    category: { name: '' },
    theme: { soft: '#EEF1F5', deep: '#2E6BFF' },
    campus: '',
    showCampusPanel: false,
    clubs: [],
    loaded: false,
    loadError: false
  },

  onLoad(options) {
    // 窗口信息：低版本基础库可能没有 getWindowInfo，逐级兜底且绝不抛错
    const info = (typeof wx.getWindowInfo === 'function' && wx.getWindowInfo()) ||
      (typeof wx.getSystemInfoSync === 'function' && wx.getSystemInfoSync()) || {}
    this.categoryId = (options && options.id) || ''
    // 校区：优先取上级页面带入（'' 表示全部校区），非法取值回退用户设置中的校区。
    // 注意 isValidCampus('') 为 false，所以「全部校区」必须单独放行。
    const campusQuery = options && options.campus
    const fromQuery = typeof campusQuery === 'string' ? decodeURIComponent(campusQuery) : null
    this.campus = fromQuery !== null && (fromQuery === '' || isValidCampus(fromQuery))
      ? fromQuery
      : getDefaultCampus()
    // 上级页面显式带入校区时视为已选定，onShow 不再用默认值覆盖
    this._campusTouched = fromQuery !== null
    this.setData({ statusBarHeight: info.statusBarHeight || 20, campus: this.campus })
    // 先用本地数据秒开（只保留列表所需字段），再拉服务端数据覆盖（后台编辑后实时生效）
    this.applyCategory(getCategoryById(this.categoryId))
    this.loadCategory()
  },

  onPullDownRefresh() {
    this.loadCategory(() => wx.stopPullDownRefresh())
  },

  onShow() {
    // 从设置页返回时同步所选校区；用户手动切过校区时尊重其选择
    if (!this._campusTouched) {
      const def = getDefaultCampus()
      if (def !== this.data.campus) {
        this.campus = def
        this.setData({ campus: def })
      }
    }
    // 首次进入由 onLoad 拉取；再次展示（从社团详情/申请页返回等）时静默刷新，
    // 申请人刚上传/更换的社团头像无需任何手动操作即可同步到列表
    if (this._entered) this.loadCategory()
    this._entered = true
  },

  // 服务端拉取当前分类（已按校区筛选）；失败时若本地兜底已渲染则静默沿用
  loadCategory(done) {
    fetchCategories(this.campus).then((categories) => {
      const matched = (categories || []).find((item) => item.id === this.categoryId)
      if (matched) {
        this.applyCategory(matched)
        this.setData({ loaded: true, loadError: false })
      } else if (!this.data.clubs.length) {
        // 服务端与本地兜底都找不到该分类
        this.setData({ loaded: true, loadError: false })
        this.failBack()
      } else {
        this.setData({ loaded: true, loadError: false })
      }
      if (typeof done === 'function') done()
    }).catch(() => {
      if (!this.data.clubs.length) this.setData({ loaded: true, loadError: true })
      if (typeof done === 'function') done()
    })
  },

  // 加载失败（且无本地兜底）→ 点击重试
  retryLoad() {
    this.setData({ loaded: false, loadError: false })
    this.loadCategory()
  },

  failBack() {
    wx.showToast({ title: '分类不存在或已下线', icon: 'none' })
    setTimeout(() => wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pkg-feature/pages/club/index' }) }), 900)
  },

  // 只保留「代表社团」列表所需字段，减小 setData 体积，切换分类更流畅
  applyCategory(category) {
    if (!category) return
    // 复用已加载完成的头像状态：URL 未变化的头像刷新后直接显示，
    // 不重新走 loading → 淡入流程，避免返回页面/下拉刷新时闪烁
    const prevByName = {}
    const prevList = this.data.clubs || []
    for (let i = 0; i < prevList.length; i++) prevByName[prevList[i].name] = prevList[i]
    const clubs = (category.clubs || []).map((club) => {
      const avatarUrl = club.avatarUrl || ''
      const prev = prevByName[club.name]
      const keepLoaded = !!(avatarUrl && prev && prev.avatarUrl === avatarUrl && prev.avatarState === 'loaded')
      return {
        id: club.id || '',
        name: club.name || '',
        tags: club.tags || '',
        firstChar: (club.name || '').charAt(0),
        // 头像同步三态：loading（弱网加载指示）/ loaded（淡入显示）/ failed（回退文字徽标 + 手动重试）
        avatarUrl,
        avatarSrc: keepLoaded ? prev.avatarSrc : avatarUrl,
        avatarState: avatarUrl ? (keepLoaded ? 'loaded' : 'loading') : 'none'
      }
    })
    this.setData({
      category: { id: category.id, name: category.name },
      theme: category.theme,
      clubs
    })
  },

  // ===== 头像同步状态 =====
  onAvatarLoad(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || !this.data.clubs[index]) return
    this.setData({ ['clubs[' + index + '].avatarState']: 'loaded' })
  },

  onAvatarError(e) {
    const index = e.currentTarget.dataset.index
    if (index === undefined || !this.data.clubs[index]) return
    this.setData({ ['clubs[' + index + '].avatarState']: 'failed' })
    // 同步失败明确提示（1.5s 内只提示一次，整列同时失败时不刷屏）；
    // 头像位置回退为文字徽标，点击 ↻ 可手动重试
    const now = Date.now()
    if (!this._avatarErrAt || now - this._avatarErrAt > 1500) {
      this._avatarErrAt = now
      wx.showToast({ title: '头像同步失败，点击头像可重试', icon: 'none' })
    }
  },

  // 手动更新：附加时间戳绕过失败 URL 的缓存，重新发起加载
  onAvatarRetry(e) {
    const index = e.currentTarget.dataset.index
    const club = this.data.clubs[index]
    if (!club || !club.avatarUrl) return
    wx.vibrateShort({ type: 'light' })
    const joiner = club.avatarUrl.indexOf('?') >= 0 ? '&' : '?'
    this.setData({
      ['clubs[' + index + '].avatarSrc']: club.avatarUrl + joiner + 'r=' + Date.now(),
      ['clubs[' + index + '].avatarState']: 'loading'
    })
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
    this.campus = campus
    this.setData({ campus, showCampusPanel: false })
    this.loadCategory()
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pkg-feature/pages/club/index' })
    })
  },

  // 点击某个社团 → 跳转社团详情页（整行跳转）
  onClubTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      // 服务端不可用时页面会回退到内置数据，本地社团没有唯一标识、无法匹配详情
      wx.showToast({ title: '社团详情暂不可用', icon: 'none' })
      return
    }
    const name = e.currentTarget.dataset.name || ''
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/pkg-feature/pages/club/club-detail?id=' + id + '&name=' + encodeURIComponent(name)
    })
  }
})
