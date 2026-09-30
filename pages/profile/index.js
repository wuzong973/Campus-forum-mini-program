const api = require("../../utils/api");
const auth = require("../../utils/auth");
const request = require("../../utils/request");
const wechat = require("../../utils/wechat");
const avatar = require("../../utils/avatar");
const { runPullDownRefresh } = require("../../utils/refresh");
const liquidTab = require("../../utils/liquid-tab");

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
    // 加载失败态：区分「用户不存在/已注销」（404）与网络失败，
    // 不能只把 loading 关掉 —— 整页 wx:if="{{profile}}" 会直接白屏，用户不知道发生了什么
    loadErrorText: '',
    // 头像加载失败标记：避免兜底路径再失败时反复替换
    avatarFailed: false,
  },

  onLoad(options) {
    const app = getApp();
    const profileId = parseInt(options.id, 10);
    if (!profileId) {
      wx.showToast({ title: "用户不存在", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    // 来源帖子：帖子详情页进入本页时携带，本页再进入私信时原样透传，
    // 聊天页据此「回到帖子」（覆盖「帖子详情→个人主页→聊天」路径）
    this.sourcePostId = parseInt(options.postId, 10) || 0;
    const currentUserId = Number((app.globalData.userInfo || {}).id || 0);
    // 「隐藏主页帖子」本地偏好只作用于本人主页；访客能否看到帖子由服务端按
    // sys_user.hide_profile_posts 过滤，避免把访问者自己的开关错套到他人主页上
    const hideProfilePosts = profileId === currentUserId && !!((wx.getStorageSync('system_settings') || {}).hideProfilePosts);
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      currentUserId,
      profileId,
      hideProfilePosts,
    });
    // 偏好开启时默认落在「收藏」tab（帖子 tab 已隐藏）
    if (hideProfilePosts) {
      this.setData({ activeTab: 1 });
    }
    // 液态标签指示条：首个 tab 可能隐藏，数据序换算渲染序后落位（无动画）
    this.liquidTab = liquidTab.create(this, {
      track: ".profile-tabbar",
      items: ".profile-tab",
      indicator: ".liquid-indicator"
    });
    wx.nextTick(() => this.liquidTab.snap(this.liquidPos()));
    this.loadPageData();
  },

  onUnload() {
    if (this.liquidTab) this.liquidTab.destroy();
  },

  // 数据序 → 渲染序：hideProfilePosts 时 0 号 tab（帖子）不渲染，其后标签整体左移一位
  liquidPos() {
    const i = this.data.activeTab;
    return this.data.hideProfilePosts ? i - 1 : i;
  },

  // 首个 tab 的可见性变化会让标签集合重排，需要重测量再落位
  syncLiquidTab() {
    if (!this.liquidTab) return;
    this.liquidTab.refresh(this.liquidPos());
  },

  onShow() {
    // 从设置页返回时同步「隐藏主页帖子」偏好（即时生效；仅本人主页适用）
    const hideProfilePosts = this.data.profileId === this.data.currentUserId && !!((wx.getStorageSync('system_settings') || {}).hideProfilePosts);
    if (hideProfilePosts !== this.data.hideProfilePosts) {
      this.setData({ hideProfilePosts, activeTab: hideProfilePosts ? 1 : 0 });
      this.syncLiquidTab();
    }
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
        // 服务端返回的头像/昵称/校区是最新的，本地 profile_ext 只补充签名等
        // 服务端没有的字段。此前用 Object.assign(profile, ext) 会让过期的本地缓存
        // 反过来覆盖服务端（甚至把服务端空值盖成旧值），导致同一用户在不同页面
        // 头像不一致。现改为：服务端有值就以服务端为准并清掉本地冲突项。
        const ext = wx.getStorageSync("profile_ext") || {};
        const currentUserProfile =
          this.data.profileId === this.data.currentUserId;
        let extDirty = false;
        ["avatarUrl", "nickName", "campus"].forEach((key) => {
          if (!ext[key]) return;
          const serverValue = profile[key];
          // 服务端有权威值 → 清缓存；服务端为空 → 也不再用缓存顶替，避免页面间不一致
          if (ext[key] !== serverValue) {
            delete ext[key];
            extDirty = true;
          }
        });
        if (extDirty) wx.setStorageSync("profile_ext", ext);
        const mergedProfile = currentUserProfile
          ? Object.assign({}, profile, ext)
          : profile;
        // 兼容重命名前的旧头像路径，避免真机渲染空白圆圈
        mergedProfile.avatarUrl = avatar.normalizeLegacyAvatar(mergedProfile.avatarUrl);
        this.setData({
          profile: mergedProfile,
          posts: posts || [],
          loading: false,
          isSelf: currentUserProfile,
          loadErrorText: "",
        });
      })
      .catch((err) => {
        // 目标用户已注销/被删除时资料接口返回 404，网络异常则是另一个错误对象。
        // 两种都要给出可读提示并留一个重试入口，否则页面停在空白处。
        const notFound = Number(err && err.statusCode) === 404;
        this.setData({
          loading: false,
          loadErrorText: notFound ? "该用户不存在或已注销" : "资料加载失败，请检查网络后重试",
        });
        wx.showToast({ title: notFound ? "用户不存在" : "资料加载失败", icon: "none" });
      });
  },

  onRetryLoad() {
    if (this.data.loading) return;
    this.setData({ loadErrorText: "" });
    this.loadPageData();
  },

  // 头像加载失败兜底：历史脏路径（不存在的内置素材名）会让头像长期空白并刷渲染层错误
  onAvatarError() {
    if (this.data.avatarFailed || !this.data.profile) return;
    const broken = String(this.data.profile.avatarUrl || "");
    const fallback = avatar.looksAnonymousAvatar(broken)
      ? avatar.pickAnonymousAvatar(this.data.profile.nickName || broken)
      : "/assets/icons/avatar.png";
    if (!fallback || fallback === broken) return;
    this.setData({ avatarFailed: true, "profile.avatarUrl": fallback });
  },

  onBack() {
    wx.navigateBack();
  },

  onTab(e) {
    this.setData({ activeTab: Number(e.currentTarget.dataset.index) });
    this.liquidTab.moveTo(this.liquidPos());
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
        '&anonymous=0' +
        // 透传来源帖子，聊天页「回到帖子」据此精确返回原帖子详情页
        (this.sourcePostId ? '&postId=' + this.sourcePostId : '')
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
