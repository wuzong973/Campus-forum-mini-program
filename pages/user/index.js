const app = getApp()
const messageStore = require('../../utils/messageStore')
const api = require('../../utils/api')
const avatar = require('../../utils/avatar')
const { runPullDownRefresh } = require('../../utils/refresh')
const subscribe = require('../../utils/subscribe')

Page({
  data: {
    statusBarHeight: 20,
    userInfo: null,
    isLogin: false,
    isAdmin: false,
    unreadCount: 0,
    shortcuts: [
      { icon: '/assets/icons/wallet.png', name: '钱包', route: '/pages/wallet/index', subscribe: 'withdraw' },
      { icon: '/assets/icons/order.png', name: '订单', route: '/pages/errand-order/index', subscribe: 'withdraw' },
      { icon: '/assets/icons/ic-lock-purple.png', name: '黑名单管理', route: '/pages/blacklist/index', iconDark: true },
      { icon: '/assets/icons/menu.png', name: '管理后台', route: '/pkg-admin/admin/index', adminOnly: true }
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
          { fontIcon: 'if-tiezi', fontColor: '#4a7aff', name: '我的帖子', route: '/pages/my-posts/index' },
          { icon: '/assets/icons/heart.png', name: '点赞我的', route: '/pages/my-messages/index?tab=2' },
          { icon: '/assets/icons/comment.png', name: '评论我的', route: '/pages/my-messages/index?tab=1' },
          { fontIcon: 'if-xiaoxitongzhi', fontColor: '#4a90f8', name: '消息通知', route: '/pages/my-messages/index?tab=5', badge: 'unread', subscribe: 'message' }
        ]
      },
      {
        title: '更新公告',
        columns: 4,
        items: [
          { fontIcon: 'if-gengxingonggao', fontColor: '#faad14', name: '更新公告', route: '/pages/announcements/index' },
          { fontIcon: 'if-guanyuwomen', fontColor: '#52c41a', name: '关于我们', route: '/pages/about/index' },
          { icon: '/assets/icons/rider.png', name: '骑手认证', route: '/pages/rider-verify/index', subscribe: 'riderVerify' },
          { fontIcon: 'if-gerenzhongxin', fontColor: '#ff7a45', name: '个人中心', route: '/pages/profile-edit/index' }
        ]
      },
      {
        title: '系统设置',
        columns: 4,
        items: [
          { fontIcon: 'if-xitongshezhi', fontColor: '#315cff', name: '系统设置', route: '/pages/settings/index' },
          { fontIcon: 'if-yijian', fontColor: '#12b8a6', name: '意见(必回)', route: '/pages/feedback/index' },
          { fontIcon: 'if-lianxikefu', fontColor: '#5e6675', name: '联系客服', type: 'contact' },
          { icon: '/assets/icons/help.png', name: '常见问题', route: '/pages/help/index' }
        ]
      }
    ]
  },

  onLoad() {
    this.unsubscribe = messageStore.onMessage((payload) => {
      if (payload && payload.type === 'banner_update') {
        // 管理员更新了消息通知横幅，实时刷新
        this.loadMsgBanner()
        return
      }
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
    userInfo.avatarUrl = avatar.normalizeLegacyAvatar(userInfo.avatarUrl)
    if (!avatar.isStoredAvatar(userInfo.avatarUrl)) userInfo.avatarUrl = defaultProfile.avatarUrl
    if (avatar.isDefaultName(userInfo.nickName)) userInfo.nickName = defaultProfile.nickName
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      userInfo,
      isLogin: !!app.globalData.token,
      isAdmin: ['super_admin', 'content_admin', 'user_admin', 'operator'].indexOf(userInfo.role) >= 0,
      unreadCount: messageStore.getUnreadTotal()
    })
    messageStore.syncUnreadCount()
    this.loadInteractionStats()
    this.loadMsgBanner()
    this.refreshUserInfo()
  },

  // 本地缓存的头像/昵称可能已过期（比如在别的设备上改过资料），
  // 每次进入页面时以服务端为准刷新，保证和帖子列表等页面的头像一致
  refreshUserInfo() {
    const current = app.globalData.userInfo
    if (!app.globalData.token || !current || !current.id) return
    api.getUserProfile(current.id).then((profile) => {
      if (!profile) return
      const serverAvatarRaw = avatar.normalizeLegacyAvatar(profile.avatarUrl)
      const serverAvatar = avatar.isStoredAvatar(serverAvatarRaw) ? serverAvatarRaw : ''
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

  // 消息通知卡片顶部横幅：点击进入详情页（详情页内管理员可编辑发布）
  loadMsgBanner() {
    api.getMessageBanner().then((banner) => {
      const data = banner || { text: '', icon: '', images: [] }
      data.bannerStyle = (data.bgColor ? 'background:' + data.bgColor + ';' : '') + (data.textColor ? '--banner-fg:' + data.textColor + ';' : '')
      this.setData({ msgBanner: data })
    }).catch(() => {})
  },

  goBannerDetail() {
    if (!this.data.msgBanner || !this.data.msgBanner.text) return
    wx.navigateTo({ url: '/pages/banner-detail/index' })
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
    this.requestEntrySubscribe(e)
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
    this.requestEntrySubscribe(e)
    wx.navigateTo({ url: route })
  },

  // 新增：入口级订阅触发。
  // 入口在 data 里用 subscribe 字段标注它归属哪个订阅触发组（如钱包/订单 → withdraw），
  // 点击时在 **tap 同步调用链内** 申请原生授权 —— 微信要求 requestSubscribeMessage
  // 必须由用户手势直接触发，放进回调/定时器会静默失败。
  //
  // 这是「复制式新增」：各业务页原有的触发方式（如提现提交成功、发布成功）完全不动，
  // 这里只是把「进入该功能前先引导授权」补上，两者共用同一个 TRIGGER_GROUPS 分组，
  // 因此弹窗文案与授权结果落库口径完全一致。
  requestEntrySubscribe(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const trigger = dataset.subscribe
    if (!trigger) return
    if (typeof subscribe.requestTriggerByTap === 'function') subscribe.requestTriggerByTap(trigger)
  }
})
