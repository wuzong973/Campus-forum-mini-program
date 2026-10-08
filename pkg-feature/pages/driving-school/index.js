// 找驾校：驾校列表页（校区分类 + 搜索 + 排序 / 服务标签筛选 + 驾校卡片）
// 数据源：服务端 driving_school 表（管理后台「找驾校内容管理」维护），
// 一次性拉取启用驾校，校区/关键词/标签/排序在本地用 utils/driving-school 纯函数即时筛选。
const ds = require('../../utils/driving-school')
const api = require('../../../utils/api')
const { getDefaultCampus } = require('../../../utils/campus')
// 卡片动效降级开关（低端机 / 设置页关闭），样式见 styles/card-fx.wxss
const motion = require('../../../utils/motion')

// 筛选面板的标签需要带选中态：WXML 里不能调方法（indexOf），选中态在 JS 里算好。
// 标签池由调用方给定（未配置时传内置 SERVICE_TAGS，配置成空数组则整组不显示），这里不做回落
function buildTagOptions(active, pool) {
  return (pool || []).map((name) => ({ name, selected: active.indexOf(name) >= 0 }))
}

function buildPassOptions(activeKey) {
  return ds.PASS_RATE_FILTERS.map((item) => ({ key: item.key, label: item.label, selected: activeKey === item.key }))
}

function buildLevelOptions(active) {
  return ds.LEVEL_FILTERS.map((name) => ({ name, selected: active.indexOf(name) >= 0 }))
}

Page({
  data: {
    campusOptions: ds.CAMPUS_OPTIONS,
    campusIndex: 0,
    campus: ds.CAMPUS_OPTIONS[0],
    keyword: '',
    sortLabels: ds.SORT_OPTIONS.map((item) => item.label),
    sortIndex: 0,
    sortKey: 'default',
    sortLabel: '',
    tagOptions: buildTagOptions([], ds.SERVICE_TAGS),
    // 顶部横幅：后台「物品 → 驾校运营横幅」可配，未配置时用内置默认文案
    promo: Object.assign({}, ds.DEFAULT_PROMO),
    activeTags: [],
    passOptions: buildPassOptions('any'),
    activePassKey: 'any',
    minPassRate: 0,
    levelOptions: buildLevelOptions([]),
    activeLevels: [],
    showFilter: false,
    schools: [],
    totalCount: 0,
    loading: true,
    // 动效降级：true 时 .fx-stage / .fx-card 挂 fx-off，只停自转与呼吸，静态描边与背光保留
    fxOff: false
  },

  onLoad() {
    // 默认停在用户「设置」里选的校区，而不是写死第一个（广州校区）
    const index = ds.CAMPUS_OPTIONS.indexOf(getDefaultCampus())
    if (index > 0) this.setData({ campusIndex: index, campus: ds.CAMPUS_OPTIONS[index] })
    this.tagPool = ds.SERVICE_TAGS
    this.loadSchools()
    this.loadPromo()
    return this.loadTagPool()
  },

  // 本页此前没有 onShow，这次只为卡片动效降级新增：在设置页关掉「卡片动效」后回到本页要立即生效
  // （与首页 onShow 同一写法；低端机判定结果不会变，但读取成本极低）
  onShow() {
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
  },

  // ===== 运营位配置（后台可改，失败一律回落到内置默认，不阻塞列表） =====
  loadPromo() {
    return api.getDrivingPromo().then((promo) => {
      const base = Object.assign({}, ds.DEFAULT_PROMO)
      if (!promo || !promo.status) { this.setData({ promo: base }); return }
      this.setData({
        promo: Object.assign(base, {
          title: String(promo.title || '').trim() || base.title,
          sub: String(promo.sub || '').trim(),
          btnText: String(promo.btnText || '').trim() || base.btnText,
          tags: (promo.tags || []).slice(0, 3),
          image: promo.image || ''
        })
      })
    }).catch(() => this.setData({ promo: Object.assign({}, ds.DEFAULT_PROMO) }))
  },

  loadTagPool() {
    return api.getDrivingServiceTags().then((cfg) => {
      // 未配置或已下线 → 内置标签池；已配置且清空 → 空数组，这一组筛选整体不显示
      const tags = cfg && cfg.status && Array.isArray(cfg.tags) ? cfg.tags : ds.SERVICE_TAGS
      this.tagPool = tags
      // 换池后已选中的旧标签若不在新池里要一并清掉，否则会筛出空结果却看不到原因
      const active = this.data.activeTags.filter((name) => tags.indexOf(name) >= 0)
      this.setData({ activeTags: active, tagOptions: buildTagOptions(active, tags) })
      this.refresh()
    }).catch(() => {
      this.tagPool = ds.SERVICE_TAGS
      this.setData({ tagOptions: buildTagOptions(this.data.activeTags, ds.SERVICE_TAGS) })
    })
  },

  onPullDownRefresh() {
    this.loadSchools().then(() => wx.stopPullDownRefresh())
  },

  loadSchools() {
    this.setData({ loading: true })
    return api.getDrivingSchools().then((list) => {
      this.all = list || []
      this.setData({ loading: false })
      this.refresh()
    }).catch(() => {
      this.all = []
      this.setData({ loading: false, schools: [], totalCount: 0 })
    })
  },

  refresh() {
    const schools = ds.filterSchools(this.all || [], {
      campus: this.data.campus,
      keyword: this.data.keyword,
      tags: this.data.activeTags,
      minPassRate: this.data.minPassRate,
      levels: this.data.activeLevels,
      sortKey: this.data.sortKey
    })
    this.setData({ schools, totalCount: schools.length })
  },

  // ===== 校区分类切换 =====
  onCampusTap(e) {
    const index = Number(e.currentTarget.dataset.index)
    const campus = ds.CAMPUS_OPTIONS[index]
    if (!campus || campus === this.data.campus) return
    wx.vibrateShort({ type: 'light' })
    this.setData({ campusIndex: index, campus })
    this.refresh()
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
    this.refresh()
  },

  onClearKeyword() {
    this.setData({ keyword: '' })
    this.refresh()
  },

  // ===== 排序 / 筛选 =====
  onSortChange(e) {
    const index = Number(e.detail.value) || 0
    const option = ds.SORT_OPTIONS[index] || ds.SORT_OPTIONS[0]
    // 「综合排序」不额外显示文案，保持工具条干净
    this.setData({ sortIndex: index, sortKey: option.key, sortLabel: index ? option.label : '' })
    this.refresh()
  },

  onToggleFilter() {
    this.setData({ showFilter: !this.data.showFilter })
  },

  onCloseFilter() {
    this.setData({ showFilter: false })
  },

  onToggleTag(e) {
    const name = e.currentTarget.dataset.tag
    if (!name) return
    const active = this.data.activeTags.slice()
    const at = active.indexOf(name)
    if (at >= 0) active.splice(at, 1)
    else active.push(name)
    this.setData({ activeTags: active, tagOptions: buildTagOptions(active, this.tagPool) })
    this.refresh()
  },

  // 通过率下限：单选（「不限」即取消该条件）
  onPickPassRate(e) {
    const key = String(e.currentTarget.dataset.key || 'any')
    const option = ds.PASS_RATE_FILTERS.find((item) => item.key === key) || ds.PASS_RATE_FILTERS[0]
    this.setData({ activePassKey: option.key, minPassRate: option.min, passOptions: buildPassOptions(option.key) })
    this.refresh()
  },

  // 推荐等级：多选，命中任一即可
  onToggleLevel(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    const active = this.data.activeLevels.slice()
    const at = active.indexOf(name)
    if (at >= 0) active.splice(at, 1)
    else active.push(name)
    this.setData({ activeLevels: active, levelOptions: buildLevelOptions(active) })
    this.refresh()
  },

  onResetFilter() {
    this.setData({
      keyword: '',
      sortIndex: 0,
      sortKey: 'default',
      sortLabel: '',
      activeTags: [],
      tagOptions: buildTagOptions([], this.tagPool),
      activePassKey: 'any',
      minPassRate: 0,
      passOptions: buildPassOptions('any'),
      activeLevels: [],
      levelOptions: buildLevelOptions([]),
      showFilter: false
    })
    this.refresh()
  },

  // ===== 跳转 =====
  onSchoolTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pkg-feature/pages/driving-school/detail?id=' + id })
  },

  // 运营横幅（校园圈学车）：进入独立的落地页（与学车指南分开，内容后台单独维护）
  openPromoLanding() {
    wx.navigateTo({ url: '/pkg-feature/pages/driving-school/landing' })
  },

  onShareAppMessage() {
    return {
      title: '找驾校：离校近、价格低、拿本快',
      path: '/pkg-feature/pages/driving-school/index'
    }
  }
})
