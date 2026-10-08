const api = require('../../../utils/api')
const auth = require('../../../utils/auth')
const { buildCategories } = require('../../utils/group-chat')
const { getDefaultCampus } = require('../../../utils/campus')
// 卡片动效降级开关（低端机 / 用户在设置里关闭）：命中时挂 .fx-off
const motion = require('../../../utils/motion')

const STATUS_TEXT = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过'
}

Page({
  data: {
    statusBarHeight: 20,
    showModal: false,
    campus: '',
    showCampusPanel: false,
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
  },

  onShow() {
    // 动效降级每次回到页面都同步：设置页刚关掉要立即生效，低端机判定不随页面变但成本极低
    const fxOff = motion.isCardFxOff()
    if (fxOff !== this.data.fxOff) this.setData({ fxOff })
    // 统一访问控制：已登录且（已登录过教务系统 或 已完成骑手认证）才加载数据
    auth.requireFeatureAccess('广轻群聊', { autoBack: true }).then((ok) => {
      if (!ok) return
      // 每次展示时与「设置」页所选校区保持同步（用户可能改过校区或刚完成登录）；
      // 用户在本页手动切过校区时尊重其选择，不强制覆盖
      if (!this._campusTouched) {
        const def = getDefaultCampus()
        if (def !== this.data.campus) this.setData({ campus: def })
      }
      this.loadGroups()
      this.loadMyApplies()
    })
  },

  onPullDownRefresh() {
    Promise.all([this.loadGroups(), this.loadMyApplies()]).catch(() => {}).then(() => wx.stopPullDownRefresh())
  },

  // 已上架群聊 → 按分类聚合为宫格卡片（按当前校区筛选；空校区=全部校区）
  // 类别优先读服务端（管理后台「群聊类别编辑」维护），失败时回退内置分类
  loadGroups() {
    return Promise.all([
      api.getGroupChatList(this.data.campus),
      api.getGroupChatCategories().catch(() => null)
    ]).then((res) => {
      const groups = (res[0] && res[0].list) || []
      const serverCategories = res[1] && res[1].list
      this.setData({ categories: buildCategories(groups, serverCategories) })
    }).catch(() => {
      // 拉取失败保持原有静默兜底：不打断页面，分类沿用上一次/内置默认
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
    this.setData({ campus, showCampusPanel: false })
    this.loadGroups()
  },

  // 我的申请：登录状态下展示审核进度与审核意见；已上架的群聊支持一键直达详情
  loadMyApplies() {
    if (!auth.isLoggedIn()) {
      this.setData({ myApplies: [] })
      return Promise.resolve()
    }
    return api.getMyGroupChatApplies().then((res) => {
      const list = ((res && res.list) || []).map((item) => Object.assign({}, item, {
        statusText: STATUS_TEXT[item.status] || item.status
      }))
      this.setData({ myApplies: list })
    }).catch(() => {})
  },

  // 「查看群聊」→ 审核通过并已上架的群聊详情
  goGroupDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pkg-feature/pages/group-chat/detail?id=' + id })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  },

  // 点击分类卡片 → 该类别下的群聊列表
  onCategoryTap(e) {
    const name = e.currentTarget.dataset.name
    if (!name) return
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/pkg-feature/pages/group-chat/list?name=' + encodeURIComponent(name)
    })
  },

  // 右下角「创建」按钮 → 弹出首次入驻弹窗
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

  // 「我已加入，去申请群聊」→ 进入申请创建群聊页（未登录先引导登录）
  onGoApply() {
    this.setData({ showModal: false })
    if (!auth.requireLogin('申请创建群聊需要先登录')) return
    wx.navigateTo({ url: '/pkg-feature/pages/group-chat/apply' })
  },

  noop() {}
})
