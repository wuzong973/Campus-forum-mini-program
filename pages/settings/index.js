const SETTINGS_KEY = 'system_settings'

const DEFAULT_SETTINGS = {
  postAnonymous: false,
  commentAnonymous: false,
  commentPublic: false,
  anonymousMessage: false,
  hideProfilePosts: false,
  messageBanner: false,
  activitySubscription: false,
  officialNotice: false,
  dailyHot: true,
  wechatGroupNotice: false,
  secondhandGroupNotice: false,
  errandGroupNotice: false
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    settings: DEFAULT_SETTINGS,
    groups: [
      {
        title: '发布',
        items: [
          { key: 'postAnonymous', icon: '/assets/icons/avatar.png', name: '发帖默认开启分身' },
          { key: 'commentAnonymous', icon: '/assets/icons/comment.png', name: '评论默认开启分身' },
          { key: 'commentPublic', icon: '/assets/icons/comment.png', name: '评论默认不开启分身' },
          { key: 'anonymousMessage', icon: '/assets/icons/message.png', name: '默认允许分身私信' }
        ]
      },
      {
        title: '隐私',
        items: [
          { key: 'hideProfilePosts', icon: '/assets/icons/privacy.png', name: '隐藏主页帖子' }
        ]
      },
      {
        title: '通知',
        items: [
          { key: 'messageBanner', icon: '/assets/icons/notice.png', name: '显示消息提醒横幅' },
          { key: 'activitySubscription', icon: '/assets/icons/star.png', name: '活动订阅' },
          { key: 'officialNotice', icon: '/assets/icons/notice.png', name: '显示公众号提示' },
          { key: 'dailyHot', icon: '/assets/icons/heart.png', name: '显示每日热榜' },
          { key: 'wechatGroupNotice', icon: '/assets/icons/message.png', name: '微信群提示' },
          { key: 'secondhandGroupNotice', icon: '/assets/icons/order.png', name: '二手物品快速交易群提示' },
          { key: 'errandGroupNotice', icon: '/assets/icons/rider.png', name: '跑腿接单群提示' }
        ]
      }
    ]
  },

  onLoad() {
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      settings: Object.assign({}, DEFAULT_SETTINGS, wx.getStorageSync(SETTINGS_KEY) || {})
    })
  },

  goBack() { wx.navigateBack() },

  onSettingChange(e) {
    const key = e.currentTarget.dataset.key
    const value = !!e.detail.value
    const settings = Object.assign({}, this.data.settings, { [key]: value })
    if (key === 'commentAnonymous' && value) settings.commentPublic = false
    if (key === 'commentPublic' && value) settings.commentAnonymous = false
    wx.setStorageSync(SETTINGS_KEY, settings)
    this.setData({ settings })
  }
})
