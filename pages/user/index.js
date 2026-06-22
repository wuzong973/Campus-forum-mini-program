const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    userInfo: null,
    isLogin: false,
    shortcuts: [
      { icon: '/assets/icons/wallet.png', name: '钱包' },
      { icon: '/assets/icons/order.png', name: '订单' },
      { icon: '/assets/icons/post.png', name: '帖子' },
      { icon: '/assets/icons/message.png', name: '消息' }
    ],
    menus: [
      { icon: '/assets/icons/security.png', name: '账号安全' },
      { icon: '/assets/icons/rules.png', name: '社区规范' },
      { icon: '/assets/icons/service.png', name: '联系客服' },
      { icon: '/assets/icons/feedback.png', name: '用户反馈' },
      { icon: '/assets/icons/help.png', name: '常见问题' },
      { icon: '/assets/icons/about.png', name: '关于我们' }
    ]
  },

  onShow() {
    const app = getApp()
    const userInfo = Object.assign(
      { school: '广东轻工职业技术大学' },
      app.globalData.userInfo || {}
    )
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      userInfo,
      isLogin: !!app.globalData.token
    })
  },

  goLogin() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: '/pages/login/index' })
    }
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  onMenuTap(e) {
    const name = e.currentTarget.dataset.name
    const routes = {
      '账号安全': '/pages/security/index',
      '社区规范': '/pages/rules/index',
      '联系客服': '/pages/feedback/index',
      '用户反馈': '/pages/feedback/index',
      '常见问题': '/pages/help/index',
      '关于我们': '/pages/agreement/index'
    }
    const url = routes[name]
    if (url) {
      wx.navigateTo({ url })
    } else {
      wx.showToast({ title: name, icon: 'none' })
    }
  },

  onShortcut(e) {
    const name = e.currentTarget.dataset.name
    const routes = {
      '钱包': '/pages/wallet/index',
      '订单': '/pages/errand-order/index',
      '帖子': '/pages/my-posts/index',
      '消息': '/pages/my-messages/index'
    }
    const url = routes[name]
    if (url) {
      wx.navigateTo({ url })
    } else {
      wx.showToast({ title: name, icon: 'none' })
    }
  }
})
