const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { buildCategories } = require('../../utils/group-chat')
const { CAMPUS_OPTIONS, getDefaultCampus } = require('../../utils/campus')

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
    campusOptions: CAMPUS_OPTIONS,
    showCampusPanel: false,
    categories: [],
    myApplies: []
  },

  onLoad() {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    // 默认选中用户在「设置」中选择的校区
    this.setData({ statusBarHeight: info.statusBarHeight || 20, campus: getDefaultCampus() })
  },

  onShow() {
    this.loadGroups()
    this.loadMyApplies()
  },

  onPullDownRefresh() {
    Promise.all([this.loadGroups(), this.loadMyApplies()]).catch(() => {}).then(() => wx.stopPullDownRefresh())
  },

  // 已上架群聊 → 按分类聚合为宫格卡片（按当前校区筛选；空校区=全部校区）
  loadGroups() {
    return api.getGroupChatList(this.data.campus).then((res) => {
      const groups = (res && res.list) || []
      this.setData({ categories: buildCategories(groups) })
    }).catch(() => {})
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

  // 我的申请：登录状态下展示审核进度与审核意见
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
      url: '/pages/group-chat/list?name=' + encodeURIComponent(name)
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

  // 「我已加入，去申请群聊」→ 进入申请创建群聊页
  onGoApply() {
    this.setData({ showModal: false })
    wx.navigateTo({ url: '/pages/group-chat/apply' })
  },

  noop() {}
})
