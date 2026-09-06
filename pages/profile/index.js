const api = require("../../utils/api");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const wechat = require("../../utils/wechat");
const { runPullDownRefresh } = require("../../utils/refresh");

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
    isSelf: false,
    avatarSaving: false,
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
      currentUserId: Number((app.globalData.userInfo || {}).id || 0),
      profileId,
    });
    this.loadPageData();
  },

  onShow() {
    if (this.data.profileId) {
      this.loadPageData(true);
    }
  },

  onPullDownRefresh() {
    runPullDownRefresh(this, () => this.loadPageData(true));
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
        if (currentUserProfile) {
          // 服务端返回的头像/昵称/校区是最新的，本地 profile_ext 只补充签名等
          // 服务端没有的字段；过期的缓存项直接清掉，避免各页面头像不一致
          let extDirty = false;
          ["avatarUrl", "nickName", "campus"].forEach((key) => {
            if (ext[key] && profile[key] && ext[key] !== profile[key]) {
              delete ext[key];
              extDirty = true;
            }
          });
          if (extDirty) wx.setStorageSync("profile_ext", ext);
        }
        const mergedProfile = currentUserProfile
          ? Object.assign({}, profile, ext)
          : profile;
        this.setData({
          profile: mergedProfile,
          posts: posts || [],
          loading: false,
          isSelf: currentUserProfile,
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

  onTab(e) {
    this.setData({ activeTab: Number(e.currentTarget.dataset.index) });
  },

  onSendMessage() {
    if (!this.data.currentUserId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/login/index' });
      return;
    }
    const profile = this.data.profile;
    if (!profile) return;
    wx.navigateTo({
      url: '/pages/chat/index?peerId=' + this.data.profileId +
        '&nick=' + encodeURIComponent(profile.nickName || '用户') +
        '&avatar=' + encodeURIComponent(profile.avatarUrl || '/assets/icons/avatar.png') +
        // 显式声明普通私信渠道，避免曾被匿名私信过的会话被强制切回匿名视图
        '&anonymous=0'
    });
  },

  onMoreTap() {
    if (this.data.isSelf) return;
    if (!auth.requireLogin('登录后才能拉黑或举报用户')) return;
    wx.showActionSheet({
      itemList: ['拉黑', '举报'],
      success: (res) => {
        if (res.tapIndex === 0) this.confirmBlockUser();
        else if (res.tapIndex === 1) this.confirmReportUser();
      },
    });
  },

  confirmBlockUser() {
    wx.showModal({
      title: '拉黑用户',
      content: '拉黑后将不再收到该用户的私信，可在「黑名单管理」中解除。',
      confirmColor: '#e64340',
      success: (res) => {
        if (res.confirm) this.blockUser();
      },
    });
  },

  async blockUser() {
    try {
      await api.blockUser(this.data.profileId);
      wx.showToast({ title: '已拉黑', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '拉黑失败', icon: 'none' });
    }
  },

  confirmReportUser() {
    wx.showModal({
      title: '举报用户',
      content: '确认提交举报吗？管理员将收到该用户编号、举报人和提交时间。',
      confirmColor: '#e64340',
      success: (res) => {
        if (res.confirm) this.reportUser();
      },
    });
  },

  async reportUser() {
    try {
      await api.reportUser(this.data.profileId);
      wx.showToast({ title: '举报已提交', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '举报失败', icon: 'none' });
    }
  },

  onSelfAvatarTap() {
    if (!this.data.isSelf || this.data.avatarSaving || !auth.requireLogin('更换头像需要先登录')) return;
    wechat.ensurePrivacyAuthorize().then((granted) => {
      if (!granted) {
        wx.showToast({ title: '需同意隐私保护指引后才能更换头像', icon: 'none' });
        return;
      }
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
          if (!path) return;
          this.setData({ avatarSaving: true });
          wx.showLoading({ title: '上传中...', mask: true });
          wechat.uploadImages([path])
            .then((urls) => {
              const avatarUrl = urls[0];
              if (!avatarUrl) throw new Error('头像上传失败，请重试');
              return request.put('/user/info', { avatarUrl }, true).then(() => avatarUrl);
            })
            .then((avatarUrl) => {
              const app = getApp();
              app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, { avatarUrl });
              wx.setStorageSync('userInfo', app.globalData.userInfo);
              this.setData({ 'profile.avatarUrl': avatarUrl, avatarSaving: false });
              wx.hideLoading();
              wx.showToast({ title: '头像已更新', icon: 'success' });
            })
            .catch((error) => {
              this.setData({ avatarSaving: false });
              wx.hideLoading();
              wx.showToast({ title: error.message || '头像更新失败', icon: 'none' });
            });
        }
      });
    });
  },
});
