const {
  REVIEW_CATEGORIES,
  REVIEW_CAMPUS_MAIN_OPTIONS,
  REVIEW_LEVELS,
  REVIEW_FLOORS,
  SORT_OPTIONS,
  GENERAL_COURSE_TAB,
  getCourseTabs,
  decorateTarget,
  parentMainOf,
  normalizeLegacyReviewCampus
} = require('../../utils/review')
const { getProfileCampus } = require('../../utils/campus')
const api = require('../../utils/api')

const LEVEL_STORAGE_KEY = 'review_level'
const CAMPUS_STORAGE_KEY = 'review_campus'

Page({
  data: {
    category: '',
    categoryName: '',
    // course / root / child 三种模式
    mode: 'root',
    parentId: 0,
    parentName: '',
    childEmptyText: '',
    isCanteen: false,
    // course：学历层次 + 次导航
    levels: REVIEW_LEVELS,
    level: '本科',
    tabs: [],
    activeTab: '',
    // root：校区次导航；child：楼层次导航
    campus: '',
    floors: REVIEW_FLOORS,
    sortOptions: SORT_OPTIONS,
    sort: 'all',
    keyword: '',
    list: [],
    page: 1,
    hasMore: true,
    loading: false,
    loaded: false,
    randomLabel: '',
    // 抽取今日美食弹层（食堂根级）：选择范围（全部/具体食堂）+ 评分限制（高于 x 分）
    randomSheetVisible: false,
    randomDropdown: '',
    randomScopeIndex: 0,
    randomScopeOptions: [{ id: 0, name: '全部' }],
    randomRatingIndex: 0,
    randomRatingOptions: ['不限', '4.5分', '4分', '3.5分'],
    drawing: false
  },

  onLoad(options) {
    const category = ['course', 'canteen', 'business'].indexOf(options.category) >= 0
      ? options.category
      : 'course'
    const meta = REVIEW_CATEGORIES.find((item) => item.key === category) || REVIEW_CATEGORIES[0]
    const parentId = Number(options.parentId) || 0
    const mode = category === 'course' ? 'course' : (parentId ? 'child' : 'root')

    const data = {
      category,
      categoryName: meta.name,
      mode,
      parentId,
      parentName: decodeURIComponent(options.parentName || ''),
      isCanteen: category === 'canteen',
      sortOptions: SORT_OPTIONS
    }

    if (mode === 'course') {
      let level = ''
      try { level = wx.getStorageSync(LEVEL_STORAGE_KEY) || '' } catch (e) { level = '' }
      if (REVIEW_LEVELS.indexOf(level) < 0) level = '本科'
      data.level = level
      data.tabs = getCourseTabs(level)
      data.activeTab = GENERAL_COURSE_TAB
    } else if (mode === 'root') {
      // 校区只区分主校区（广州/佛山）：入口透传 → 上次选择 → 个人设置校区（分校区归入所属主校区）→ 默认
      let campus = parentMainOf(normalizeLegacyReviewCampus(decodeURIComponent(options.campus || '')))
      if (!campus) {
        try { campus = parentMainOf(normalizeLegacyReviewCampus(wx.getStorageSync(CAMPUS_STORAGE_KEY))) } catch (e) { campus = '' }
      }
      if (!campus) campus = parentMainOf(getProfileCampus())
      if (!campus) campus = REVIEW_CAMPUS_MAIN_OPTIONS[0]
      data.campus = campus
      data.tabs = REVIEW_CAMPUS_MAIN_OPTIONS
      data.activeTab = campus
      data.randomLabel = category === 'canteen' ? '🍜 抽取今日美食' : '🎲 随机逛一逛'
    } else {
      const floor = decodeURIComponent(options.floor || '')
      data.tabs = REVIEW_FLOORS
      data.activeTab = REVIEW_FLOORS.indexOf(floor) >= 0 ? floor : REVIEW_FLOORS[0]
      data.childEmptyText = category === 'canteen'
        ? '这里还没有窗口，点右下角 ✏️ 添加一个吧'
        : '这里还没有店铺，点右下角 ✏️ 添加一个吧'
    }

    this.setData(data)
    this.applyTitle()
    this.reload()
  },

  onShow() {
    // 首次进入由 onLoad 负责加载；从发布页/详情页返回时刷新，新增对象与最新评分即时可见
    if (!this.hasShown) {
      this.hasShown = true
      return
    }
    this.reload()
  },

  applyTitle() {
    let title = this.data.categoryName
    if (this.data.mode === 'child' && this.data.parentName) title = this.data.parentName
    wx.setNavigationBarTitle({ title })
  },

  // ===== 查询参数：三种模式各一套次导航维度 =====
  buildQuery(page) {
    const query = {
      category: this.data.category,
      sort: this.data.sort,
      page
    }
    if (this.data.keyword) query.keyword = this.data.keyword
    if (this.data.mode === 'course') {
      query.grade = this.data.activeTab
      query.level = this.data.level
    } else if (this.data.mode === 'root') {
      query.campus = this.data.campus
    } else {
      query.parentId = this.data.parentId
      query.floor = this.data.activeTab
    }
    return query
  },

  reload() {
    this.setData({ page: 1, list: [], hasMore: true, loaded: false })
    this.loadPage()
  },

  loadPage() {
    if (this.data.loading || !this.data.hasMore) return Promise.resolve()
    this.setData({ loading: true })
    const page = this.data.page
    return api.getReviewTargets(this.buildQuery(page)).then((res) => {
      const items = ((res && res.list) || []).map(decorateTarget)
      this.setData({
        list: this.data.list.concat(items),
        page: page + 1,
        hasMore: !!(res && res.hasMore),
        loading: false,
        loaded: true
      })
    }).catch(() => {
      this.setData({ loading: false, loaded: true, hasMore: false })
    })
  },

  onPullDownRefresh() {
    this.setData({ page: 1, list: [], hasMore: true })
    this.loadPage().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadPage()
  },

  // ===== 次导航 =====
  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) return
    if (this.data.tabs.indexOf(tab) < 0) return
    wx.vibrateShort({ type: 'light' })
    const patch = { activeTab: tab }
    // 校区切换记住选择，下次进入沿用（主校区）
    if (this.data.mode === 'root') {
      patch.campus = tab
      try { wx.setStorageSync(CAMPUS_STORAGE_KEY, tab) } catch (e) { /* 忽略 */ }
    }
    this.setData(patch)
    this.reload()
  },

  // 学历层次切换：重建次导航（通识课恒在首位）
  onLevelTap(e) {
    const level = e.currentTarget.dataset.level
    if (!level || level === this.data.level) return
    if (REVIEW_LEVELS.indexOf(level) < 0) return
    wx.vibrateShort({ type: 'light' })
    const tabs = getCourseTabs(level)
    const activeTab = tabs.indexOf(this.data.activeTab) >= 0 ? this.data.activeTab : GENERAL_COURSE_TAB
    this.setData({ level, tabs, activeTab })
    try { wx.setStorageSync(LEVEL_STORAGE_KEY, level) } catch (e) { /* 忽略 */ }
    this.reload()
  },

  // ===== 排序 / 搜索 =====
  onSortTap(e) {
    const sort = e.currentTarget.dataset.sort
    if (!sort || sort === this.data.sort) return
    this.setData({ sort })
    this.reload()
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.reload()
  },

  // ===== 随机抽取（食堂 / 商圈根级） =====
  onRandom() {
    // 食堂：弹出「抽取今日美食」筛选面板；商圈沿用直接随机
    if (this.data.isCanteen) {
      const options = [{ id: 0, name: '全部' }].concat(
        (this.data.list || []).map((item) => ({ id: item.id, name: item.name }))
      )
      this.setData({
        randomSheetVisible: true,
        randomDropdown: '',
        randomScopeOptions: options,
        randomScopeIndex: Math.min(this.data.randomScopeIndex || 0, options.length - 1)
      })
      return
    }
    this.drawRandom({ category: this.data.category, campus: this.data.campus })
  },

  onRandomClose() {
    this.setData({ randomSheetVisible: false, randomDropdown: '' })
  },

  noop() {},

  onRandomDropdownToggle(e) {
    const name = e.currentTarget.dataset.dropdown
    this.setData({ randomDropdown: this.data.randomDropdown === name ? '' : name })
  },

  onRandomScopePick(e) {
    this.setData({ randomScopeIndex: Number(e.currentTarget.dataset.index) || 0, randomDropdown: '' })
  },

  onRandomRatingPick(e) {
    this.setData({ randomRatingIndex: Number(e.currentTarget.dataset.index) || 0, randomDropdown: '' })
  },

  onRandomDraw() {
    if (this.data.drawing) return
    const query = { category: this.data.category, campus: this.data.campus }
    const scope = this.data.randomScopeOptions[this.data.randomScopeIndex] || { id: 0 }
    if (scope.id) {
      query.parentId = scope.id
    } else {
      // 全部 = 根级 + 子级全层级抽取
      query.scope = 'all'
    }
    const minRating = [0, 4.5, 4, 3.5][this.data.randomRatingIndex] || 0
    if (minRating) query.minRating = minRating
    this.setData({ drawing: true })
    this.drawRandom(query, () => this.setData({ drawing: false, randomSheetVisible: false, randomDropdown: '' }))
  },

  drawRandom(query, done) {
    api.getRandomReviewTarget(query).then((res) => {
      const target = res && res.target
      if (!target || !target.id) {
        wx.showToast({ title: '暂无符合条件的对象', icon: 'none' })
        return
      }
      if (done) done()
      wx.vibrateShort({ type: 'light' })
      wx.navigateTo({ url: '/pages/review/target?id=' + target.id })
    }).catch(() => {
      wx.showToast({ title: '暂无符合条件的对象', icon: 'none' })
    }).then(() => { if (done) done() })
  },

  onTargetTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    // 根级的食堂/商圈先下钻看窗口、店铺（楼层在子页里切）；
    // 子级条目与课程本身就是可评分的叶子，直接进详情
    if (this.data.mode === 'root') {
      const item = (this.data.list || []).find((row) => Number(row.id) === Number(id)) || {}
      wx.navigateTo({
        url: '/pages/review/list?category=' + this.data.category
          + '&parentId=' + id
          + '&parentName=' + encodeURIComponent(item.name || '')
      })
      return
    }
    wx.navigateTo({ url: '/pages/review/target?id=' + id })
  },

  // 发布评分对象（与食堂评价相同的添加方式）
  onPublish() {
    let url = '/pages/review/publish?category=' + this.data.category
    if (this.data.mode === 'course') {
      url += '&level=' + encodeURIComponent(this.data.level) + '&grade=' + encodeURIComponent(this.data.activeTab)
    } else if (this.data.mode === 'root') {
      url += '&campus=' + encodeURIComponent(this.data.campus)
    } else {
      url += '&parentId=' + this.data.parentId + '&parentName=' + encodeURIComponent(this.data.parentName) + '&floor=' + encodeURIComponent(this.data.activeTab)
    }
    wx.navigateTo({ url })
  }
})
