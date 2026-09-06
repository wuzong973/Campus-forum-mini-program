const app = getApp()
const messageStore = require('../../utils/messageStore')
const api = require('../../utils/api')
const avatar = require('../../utils/avatar')
const { runPullDownRefresh } = require('../../utils/refresh')

Page({
  data: {
    statusBarHeight: 20,
    userInfo: null,
    isLogin: false,
    isAdmin: false,
    unreadCount: 0,
    shortcuts: [
      { icon: '/assets/icons/wallet.png', name: '钱包', route: '/pages/wallet/index' },
      { icon: '/assets/icons/order.png', name: '订单', route: '/pages/errand-order/index' },
      { icon: '/assets/icons/ic-lock-purple.png', name: '黑名单管理', route: '/pages/blacklist/index', iconDark: true },
      { icon: '/assets/icons/menu.png', name: '管理后台', route: '/pages/admin/index', adminOnly: true }
    ],
    interactionStats: { liked: 0, shared: 0, commented: 0, favorited: 0 },
    sections: [
      {
        title: '消息通知',
        columns: 4,
        stats: [
          { icon: '/assets/icons/heart-outline.png', name: '已点赞', route: '/pages/my-interactions/index?type=liked', stat: 'liked' },
          { icon: '/assets/icons/share.png', name: '已转发', route: '/pages/my-interactions/index?type=shared', stat: 'shared' },
          { icon: '/assets/icons/comment.png', name: '已评论', route: '/pages/my-interactions/index?type=commented', stat: 'commented' },
          { icon: '/assets/icons/star-outline.png', name: '已收藏', route: '/pages/my-interactions/index?type=favorited', stat: 'favorited' }
        ],
        items: [
          { icon: '/assets/icons/post.png', name: '我的帖子', route: '/pages/my-posts/index' },
          { icon: '/assets/icons/heart.png', name: '点赞我的', route: '/pages/my-messages/index?tab=2' },
          { icon: '/assets/icons/comment.png', name: '评论我的', route: '/pages/my-messages/index?tab=1' },
          { icon: '/assets/icons/notice.png', name: '消息通知', route: '/pages/my-messages/index?tab=3', badge: 'unread' }
        ]
      },
      {
        title: '更新公告',
        columns: 4,
        items: [
          { icon: '/assets/icons/notice.png', name: '更新公告', route: '/pages/announcements/index' },
          { icon: '/assets/icons/about.png', name: '关于我们', route: '/pages/about/index' },
          { icon: '/assets/icons/rider.png', name: '骑手认证', route: '/pages/rider-verify/index' },
          { icon: '/assets/icons/avatar.png', name: '个人中心', route: '/pages/profile-edit/index' }
        ]
      },
      {
        title: '系统设置',
        columns: 4,
        items: [
          { icon: '/assets/icons/settings.png', name: '系统设置', route: '/pages/settings/index' },
          { icon: '/assets/icons/feedback.png', name: '意见(必回)', route: '/pages/feedback/index' },
          { icon: '/assets/icons/service.png', name: '联系客服', type: 'contact' },
          { icon: '/assets/icons/help.png', name: '常见问题', route: '/pages/help/index' }
        ]
      }
    ]
  },

  onLoad() {
    this.unsubscribe = messageStore.onMessage(() => {
      this.setData({ unreadCount: messageStore.getUnreadTotal() })
    })
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe()
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setSelected(3)
    const defaultProfile = avatar.getDefaultProfile()
    const userInfo = Object.assign({}, defaultProfile, app.globalData.userInfo || {})
    if (!avatar.isStoredAvatar(userInfo.avatarUrl)) userInfo.avatarUrl = defaultProfile.avatarUrl
    if (avatar.isDefaultName(userInfo.nickName)) userInfo.nickName = defaultProfile.nickName
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      userInfo,
      isLogin: !!app.globalData.token,
      isAdmin: ['super_admin', 'content_admin', 'user_admin', 'operator'].indexOf(userInfo.role) >= 0,
      unreadCount: messageStore.getUnreadTotal()
    })
    this.loadInteractionStats()
    this.refreshUserInfo()
  },

  // 本地缓存的头像/昵称可能已过期（比如在别的设备上改过资料），
  // 每次进入页面时以服务端为准刷新，保证和帖子列表等页面的头像一致
  refreshUserInfo() {
    const current = app.globalData.userInfo
    if (!app.globalData.token || !current || !current.id) return
    api.getUserProfile(current.id).then((profile) => {
      if (!profile) return
      const serverAvatar = avatar.isStoredAvatar(profile.avatarUrl) ? profile.avatarUrl : ''
      const serverNick = avatar.isDefaultName(profile.nickName) ? '' : profile.nickName
      const fresh = Object.assign({}, current, {
        avatarUrl: serverAvatar || current.avatarUrl,
        nickName: serverNick || current.nickName,
        campus: profile.campus || current.campus
      })
      if (fresh.avatarUrl === current.avatarUrl && fresh.nickName === current.nickName) return
      app.globalData.userInfo = fresh
      wx.setStorageSync('userInfo', fresh)
      this.setData({ userInfo: Object.assign({}, avatar.getDefaultProfile(), fresh) })
    }).catch(() => {})
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadInteractionStats())
  },

  loadInteractionStats() {
    if (!this.data.isLogin) {
      this.setData({ interactionStats: { liked: 0, shared: 0, commented: 0, favorited: 0 } })
      return
    }
    api.getMyInteractionStats().then((stats) => {
      this.setData({ interactionStats: stats })
    }).catch(() => {})
  },

  goLogin() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }
    wx.navigateTo({ url: '/pages/profile/index?id=' + (this.data.userInfo.id || '') })
  },

  goSettings() { wx.navigateTo({ url: '/pages/account-settings/index' }) },

  onShortcutTap(e) {
    const route = e.currentTarget.dataset.route
    const adminOnly = !!e.currentTarget.dataset.adminOnly
    if (!route) return
    if (adminOnly && !this.data.isAdmin) {
      wx.showToast({ title: '无管理员权限', icon: 'none' })
      return
    }
    wx.navigateTo({ url: route })
  },

  onFeatureTap(e) {
    const route = e.currentTarget.dataset.route
    const adminOnly = !!e.currentTarget.dataset.adminOnly
    if (!route) return
    if (adminOnly && !this.data.isAdmin) {
      wx.showToast({ title: '无管理员权限', icon: 'none' })
      return
    }
    wx.navigateTo({ url: route })
  }
})
