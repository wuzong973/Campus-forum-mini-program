const wechat = require("../../utils/wechat");
const auth = require("../../utils/auth");
const { runPullDownRefresh } = require("../../utils/refresh");

Page({
  data: {
    loading: false,
    agreementChecked: false
  },

  onLoad() {
    // Only restore a consent choice that the user made explicitly before.
    this.setData({ agreementChecked: wx.getStorageSync('agreementAgreed') === true });
  },

  // 登录成功后的统一处理：建立 WebSocket + 同步未读数
  _postLogin() {
    try {
      getApp().onLogin && getApp().onLogin();
    } catch (e) {}
  },

  _finishLogin(user, simulated) {
    auth.saveUser(user);
    this._postLogin();
    wx.showToast({ title: simulated ? "登录成功（模拟）" : "登录成功", icon: "success" });
    const pages = getCurrentPages();
    if (pages.length > 1) {
      setTimeout(() => wx.navigateBack(), 900);
    } else {
      setTimeout(() => wx.switchTab({ url: "/pages/user/index" }), 900);
    }
  },

  loginWithCode(phoneCode) {
    if (this.data.loading) return;
    if (!this.data.agreementChecked) {
      wx.showToast({ title: '请先阅读并勾选同意相关协议', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wechat
      .phoneLogin(phoneCode || "")
      .then((user) => this._finishLogin(user, false))
      .catch((err) => {
        const msg = (err && err.message) || "登录失败，请重试";
        wx.showToast({ title: msg, icon: "none" });
      })
      .then(() => {
        this.setData({ loading: false });
      });
  },

  onGetPhoneNumber(e) {
    if (!this.data.agreementChecked) {
      wx.showToast({ title: '请先阅读并勾选同意相关协议', icon: 'none' });
      return;
    }
    const hasCode = !!(e.detail && e.detail.code);
    const isFail =
      e.detail && e.detail.errMsg && e.detail.errMsg.indexOf("fail") !== -1;

    // 用户明确拒绝授权
    if (isFail) {
      wx.showToast({ title: "您已取消手机号授权", icon: "none" });
      return;
    }

    // 必须有 code 才能继续
    if (!hasCode) {
      wx.showToast({ title: "未获取到手机号授权，请重试", icon: "none" });
      return;
    }

    this.loginWithCode(e.detail.code);
  },

  onLoginTap() {
    if (!this.data.agreementChecked) {
      wx.showToast({ title: '请先阅读并勾选同意相关协议', icon: 'none' });
    }
  },

  toggleAgreement() {
    const agreementChecked = !this.data.agreementChecked;
    this.setData({ agreementChecked });
    if (agreementChecked) {
      wx.setStorageSync('agreementAgreed', true);
      return;
    }
    wx.removeStorageSync('agreementAgreed');
    getApp().globalData.privacyAuthorized = false;
  },

  // 跳转到协议页面
  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  // 取消登录，返回首页
  onCancel() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onPullDownRefresh() {
    runPullDownRefresh(this);
  }
});
