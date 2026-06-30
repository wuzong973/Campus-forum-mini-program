const app = getApp();
const messageStore = require("../../utils/messageStore");
const api = require("../../utils/api");

Page({
  data: {
    statusBarHeight: 20,
    userInfo: null,
    isLogin: false,
    unreadCount: 0,
    shortcuts: [
      { icon: "/assets/icons/wallet.png", name: "钱包" },
      { icon: "/assets/icons/order.png", name: "订单" },
      { icon: "/assets/icons/post.png", name: "帖子" },
      { icon: "/assets/icons/message.png", name: "消息" },
    ],
    interactionStats: {
      liked: 0,
      shared: 0,
      commented: 0,
      favorited: 0,
    },
    interactionShortcuts: [
      { key: "liked", icon: "/assets/icons/heart.png", name: "已点赞" },
      { key: "shared", icon: "/assets/icons/share.png", name: "已转发" },
      { key: "commented", icon: "/assets/icons/comment.png", name: "已评论" },
      { key: "favorited", icon: "/assets/icons/star.png", name: "已收藏" },
    ],
    menus: [
      { icon: "/assets/icons/edit.png", name: "编辑个人主页" },
      { icon: "/assets/icons/service.png", name: "联系客服" },
      { icon: "/assets/icons/feedback.png", name: "用户反馈" },
      { icon: "/assets/icons/help.png", name: "常见问题" },
    ],
  },

  onLoad() {
    // 注册实时消息回调，更新消息红点
    this.unsubscribe = messageStore.onMessage(() => {
      this.setData({ unreadCount: messageStore.getUnreadTotal() });
    });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  onShow() {
    const app = getApp();
    const userInfo = Object.assign(
      { school: "广东轻工职业技术大学" },
      app.globalData.userInfo || {},
    );
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      userInfo,
      isLogin: !!app.globalData.token,
      unreadCount: messageStore.getUnreadTotal(),
    });
    this.loadInteractionStats();
  },

  goLogin() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/index" });
    } else {
      wx.navigateTo({ url: "/pages/profile/index?id=" + (this.data.userInfo.id || '') });
    }
  },

  goSettings() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  onMenuTap(e) {
    const name = e.currentTarget.dataset.name;
    const routes = {
      编辑个人主页: "/pages/profile-edit/index",
      联系客服: "/pages/feedback/index",
      用户反馈: "/pages/feedback/index",
      常见问题: "/pages/help/index",
    };
    const url = routes[name];
    if (url) {
      wx.navigateTo({ url });
    } else {
      wx.showToast({ title: name, icon: "none" });
    }
  },

  onShortcut(e) {
    const name = e.currentTarget.dataset.name;
    const routes = {
      钱包: "/pages/wallet/index",
      订单: "/pages/errand-order/index",
      帖子: "/pages/my-posts/index",
      消息: "/pages/my-messages/index",
    };
    const url = routes[name];
    if (url) {
      wx.navigateTo({ url });
    } else {
      wx.showToast({ title: name, icon: "none" });
    }
  },

  loadInteractionStats() {
    if (!this.data.isLogin) {
      this.setData({
        interactionStats: { liked: 0, shared: 0, commented: 0, favorited: 0 },
      });
      return;
    }
    api
      .getMyInteractionStats()
      .then((stats) => {
        this.setData({ interactionStats: stats });
      })
      .catch(() => {});
  },

  onInteractionShortcut(e) {
    const key = e.currentTarget.dataset.key;
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/index" });
      return;
    }
    wx.navigateTo({ url: "/pages/my-interactions/index?type=" + key });
  },
});
