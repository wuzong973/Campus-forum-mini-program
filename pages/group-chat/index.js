const api = require('../../utils/api')
const { isLoggedIn } = require('../../utils/auth')

const STATUS_TEXT = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过'
}

Page({
  data: {
    statusBarHeight: 20,
    showModal: false,
    groups: [],
    myApplies: []
  },

  onLoad() {
    const info = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })
  },

  onShow() {
    this.loadGroups()
    this.loadMyApplies()
  },

  onPullDownRefresh() {
    Promise.all([this.loadGroups(), this.loadMyApplies()]).catch(() => {}).then(() => wx.stopPullDownRefresh())
  },

  // 已上架群聊：后台审核通过后自动出现在这里
  loadGroups() {
    return api.getGroupChatList().then((res) => {
      this.setData({ groups: (res && res.list) || [] })
    }).catch(() => {})
  },

  // 我的申请：登录状态下展示审核进度与审核意见
  loadMyApplies() {
    if (!isLoggedIn()) {
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

  // 点击群聊卡片 → 预览进群二维码
  onGroupTap(e) {
    const qrcode = e.currentTarget.dataset.qrcode
    if (!qrcode) {
      wx.showToast({ title: '该群暂未配置二维码', icon: 'none' })
      return
    }
    wx.previewImage({ urls: [qrcode] })
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
