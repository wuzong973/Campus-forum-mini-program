const wechat = require("../../utils/wechat");
const auth = require("../../utils/auth");

Page({
  data: { loading: false },

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

  loginWithCode(phoneCode, simulated) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    wechat
      .phoneLogin(phoneCode || "")
      .then((user) => this._finishLogin(user, simulated))
      .catch((err) => {
        const msg = (err && err.message) || "登录失败，请重试";
        wx.showToast({ title: msg, icon: "none" });
      })
      .then(() => {
        this.setData({ loading: false });
      });
  },

  onGetPhoneNumber(e) {
    const hasCode = !!(e.detail && e.detail.code);
    const isFail =
      e.detail && e.detail.errMsg && e.detail.errMsg.indexOf("fail") !== -1;

    // 模拟器中 getPhoneNumber 无法获取真实 code，走 mock 登录
    if (!hasCode && isFail) {
      this.loginWithCode("", true);
      return;
    }

    // 用户明确拒绝授权
    if (isFail) {
      wx.showToast({ title: "您已取消手机号授权", icon: "none" });
      return;
    }

    // 必须有 code 才能继续
    if (!hasCode) {
      this.loginWithCode("", true);
      return;
    }

    this.loginWithCode(e.detail.code, false);
  },
});
