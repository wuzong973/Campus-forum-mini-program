const { CLUB_CATEGORIES, fetchCategories } = require('../../utils/club-data')
const { getDefaultCampus } = require('../../utils/campus')
const api = require('../../utils/api')
const auth = require('../../utils/auth')
// 卡片动效降级开关（低端机 / 用户在设置里关闭）：命中时挂 .fx-off
const motion = require('../../utils/motion')

const STATUS_TEXT = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过'
}

Page({
  data: {
    statusBarHeight: 20,
    campus: '',
    showCampusPanel: false,
    showModal: false,
    categories: [],
    myApplies: [],
    // 动效降级：低端机或用户在「设置 → 显示 → 卡片动效」关闭时为 true，挂 .fx-off
    fxOff: false
  },

  onLoad() {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    // 默认选中用户在「设置」中选择的校区
    this.setData({ statusBarHeight: info.statusBarHeight || 20, campus: getDefaultCampus() })
    // 先用本地数据秒开（只保留宫格所需字段），再拉服务端数据覆盖（后台编辑后实时生效）
    this.setData({ categories: this.toGridItems(CLUB_CATEGORIES) })
  },

  // 宫格卡片仅需要 5 个字段：裁掉 position/scope/features/intro 等大字段，
  // 显著减小首屏 setData 体积，提升首次渲染速度
  toGridItems(categories) {
    return (categories || []).map((item) => ({
      id: item.id,
      char: item.char,
      name: item.name,
      slogan: item.slogan,
      theme: item.theme
    }))
  },

  onShow() {
    // 动效降级每次回到页面都同步：设置页刚关掉要立即生效，低端机判定不随页面变但成本极低
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
    // 统一访问控制：已登录且（已登录过教务系统 或 已完成骑手认证）才加载数据
    auth.requireFeatureAccess('社团&组织', { autoBack: true }).then((ok) => {
      if (!ok) return
      // 每次展示时重新拉取：后台审核通过的社团、刚提交的申请进度都能即时反映
      this.loadServerData()
      this.loadMyApplies()
    })
  },

  onPullDownRefresh() {
    this.loadServerData(() => wx.stopPullDownRefresh())
    this.loadMyApplies()
  },

  loadServerData(done) {
    fetchCategories(this.data.campus).then((categories) => {
      if (!categories || !categories.length) {
        if (typeof done === 'function') done()
        return
      }
      this.setData({ categories: this.toGridItems(categories) })
      if (typeof done === 'function') done()
    }).catch(() => {
      if (typeof done === 'function') done()
    })
  },

  // 我的社团申请：登录状态下展示审核进度与审核意见
  loadMyApplies() {
    if (!auth.isLoggedIn()) {
      this.setData({ myApplies: [] })
      return Promise.resolve()
    }
    return api.getMyClubApplies().then((res) => {
      const list = ((res && res.list) || []).map((item) => Object.assign({}, item, {
        statusText: STATUS_TEXT[item.status] || item.status
      }))
      this.setData({ myApplies: list })
    }).catch(() => {})
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
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
    if (campus === this.data.campus) {
      this.setData({ showCampusPanel: false })
      return
    }
    wx.vibrateShort({ type: 'light' })
    this.setData({ campus, showCampusPanel: false })
    this.loadServerData()
  },

  // 点击分类卡片 → 该分类下的代表社团列表
  onCategoryTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/pages/club/detail?id=' + id + '&campus=' + encodeURIComponent(this.data.campus)
    })
  },

  // 右下角「申请」按钮 → 弹出首次入驻弹窗
  onCreate() {
    this.setData({ showModal: true })
  },

  onCloseModal() {
    this.setData({ showModal: false })
  },

  // 加入微信意见群：管理员未配置时给出提示
  onJoinOpinionGroup() {
    wx.showToast({ title: '管理员暂未配置微信意见群', icon: 'none' })
  },

  // 「我已知晓，去申请社团」→ 进入申请创建社团页（未登录先引导登录）
  onGoApply() {
    this.setData({ showModal: false })
    if (!auth.requireLogin('申请创建社团需要先登录')) return
    wx.navigateTo({ url: '/pages/club/apply' })
  },

  noop() {}
})
