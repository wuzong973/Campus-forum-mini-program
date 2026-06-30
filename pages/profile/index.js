const api = require("../../utils/api");
const auth = require("../../utils/auth");

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    profileId: 0,
    currentUserId: 0,
    profile: null,
    posts: [],
    activeTab: 0,
    tabs: ["帖子", "收藏"],
    loading: true,
  },

  onLoad(options) {
    const app = getApp();
    const profileId = parseInt(options.id, 10);
    if (!profileId) {
      wx.showToast({ title: "用户不存在", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      currentUserId: (app.globalData.userInfo || {}).id || 0,
      profileId,
    });
    this.loadPageData();
  },

  onShow() {
    if (this.data.profileId) {
      this.loadPageData(true);
    }
  },

  loadPageData(silent) {
    if (!silent) {
      this.setData({ loading: true });
    }
    Promise.all([
      api.getUserProfile(this.data.profileId),
      api.getUserPosts(this.data.profileId),
    ])
      .then(([profile, posts]) => {
        const ext = wx.getStorageSync("profile_ext") || {};
        const currentUserProfile =
          this.data.profileId === this.data.currentUserId;
        const mergedProfile = currentUserProfile
          ? Object.assign({}, profile, ext)
          : profile;
        this.setData({
          profile: mergedProfile,
          posts: posts || [],
          loading: false,
        });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: "资料加载失败", icon: "none" });
      });
  },

  onBack() {
    wx.navigateBack();
  },

  onMessage() {
    const profile = this.data.profile;
    if (!profile) return;
    if (!auth.requireLogin("私信需要先登录")) return;
    if (profile.id === this.data.currentUserId) {
      wx.showToast({ title: "这是你自己", icon: "none" });
      return;
    }
    wx.navigateTo({
      url:
        "/pages/chat/index?peerId=" +
        profile.id +
        "&nick=" +
        encodeURIComponent(profile.nickName || "用户") +
        "&avatar=" +
        encodeURIComponent(profile.avatarUrl || "/assets/icons/avatar.png"),
    });
  },

  onTab(e) {
    this.setData({ activeTab: Number(e.currentTarget.dataset.index) });
  },
});
